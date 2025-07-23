//Purpose:  Download CDR Billing data from VoIP Innovations daily
//          and store in SQL with enhanced processing and error handling
//
//Author:  Marc Dittmer (marc@t-rexsystems.com)
//Created: March 2022
//Updated: Enhanced with JavaScript processing and error handling

require('dotenv').config();

const ftp = require("basic-ftp");
const fs = require("fs");
const Papa = require("papaparse");
const sql = require("mssql");
const nodemailer = require("nodemailer");

var today = new Date();
console.log("today: " + today);
var dd = String(today.getDate()).padStart(2, "0");
var mm = String(today.getMonth() + 1).padStart(2, "0"); //January is 0!
var yyyy = today.getFullYear();
const todayFolder = yyyy + mm + dd;
console.log("filename: " + todayFolder);

const dbconfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT) || 300000,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
  },
};

// Create directories if they don't exist
if (!fs.existsSync('./cdrs')) {
  fs.mkdirSync('./cdrs', { recursive: true });
}
if (!fs.existsSync('./bak')) {
  fs.mkdirSync('./bak', { recursive: true });
}

VoIPCDRs();

async function VoIPCDRs() {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: process.env.FTP_SECURE === 'true',
    });

    client.trackProgress((info) => {
      console.log(`Downloading: ${info.name} - ${info.bytes} bytes`);
    });

    await client.cd("/" + todayFolder + "/"); //folder is actually todays date but the file inside is yesterdays
    await client.downloadToDir("./cdrs/");

    console.log("FTP download completed successfully");

  } catch (err) {
    console.error("FTP download failed:", err);
    await sendAlert("CDR FTP Download Failed", err.message);
    return;
  }

  client.close();
  console.log("FTP connection closed");
  processDownloadedFiles();
}

// Process downloaded files
function processDownloadedFiles() {
  let directory_name = "./cdrs/";

  try {
    let filenames = fs.readdirSync(directory_name);
    console.log("\nFilenames: " + filenames);

    if (filenames.length === 0) {
      console.log("No files found to process");
      sendAlert("CDR Processing Warning", "No CDR files found for processing");
      return;
    }

    filenames.forEach((file) => {
      console.log("Processing file: ", file);
      let cdrfilename = file;
      ParseCDRs(cdrfilename);
      fs.unlinkSync("./cdrs/" + cdrfilename); //deletes original CDR file
    });

  } catch (err) {
    console.error("Error processing downloaded files:", err);
    sendAlert("CDR File Processing Failed", err.message);
  }
}

function ParseCDRs(cdrfilename) {
  const config = {
    delimiter: ";",
    header: true,
    skipEmptyLines: true,
  };

  try {
    console.log("Parsing CDR file: ", cdrfilename);
    const cdrfile = fs.readFileSync("./cdrs/" + cdrfilename, "utf8");
    const parcdr = Papa.parse(cdrfile, config);
    const parsedCDRs = parcdr.data;

    // Process and clean the CDR data
    const processedCDRs = processAndCleanCDRs(parsedCDRs);
    console.log(`Processed ${processedCDRs.length} CDR records`);

    SaveCDRFiles(processedCDRs, cdrfilename);

  } catch (err) {
    console.error(`Error parsing CDR file ${cdrfilename}:`, err);
    sendAlert(`CDR Parsing Failed: ${cdrfilename}`, err.message);
  }
}

function processAndCleanCDRs(parsedCDRs) {
  let invalidPhoneNumbers = [];
  
  const processedRecords = parsedCDRs.map(record => {
    try {
      // Timezone conversion (PST offset)
      let startTime = null;
      if (record.StartTime) {
        startTime = new Date(record.StartTime);
        // Calculate PST offset dynamically
        const pstOffset = getPSTOffset(startTime);
        startTime.setHours(startTime.getHours() + pstOffset);
      }

      // Clean phone numbers and track invalid ones
      let ani = cleanPhoneNumber(record.ANI);
      let dnis = cleanPhoneNumber(record.DNIS);
      
      // Track invalid phone numbers for alerting
      if (!ani && record.ANI) {
        invalidPhoneNumbers.push(`ANI: ${record.ANI}`);
      }
      if (!dnis && record.DNIS) {
        invalidPhoneNumbers.push(`DNIS: ${record.DNIS}`);
      }

      return {
        StartTime: startTime ? startTime.toISOString() : null,
        BillDuration: parseInt(record.BillDuration) || 0,
        CallPrice: parseFloat(record.CallPrice) || 0.0,
        ANI: ani,
        DNIS: dnis,
        CustomerIP: record.CustomerIP || '',
        CallType: record.CallType || '',
        LRN: record.LRN || '' // Keep for reference but don't use for DNIS
      };
    } catch (err) {
      console.warn(`Error processing record:`, err, record);
      return null;
    }
  }).filter(record => record !== null);
  
  // Send alert if significant number of invalid phone numbers found
  if (invalidPhoneNumbers.length > 0) {
    const threshold = Math.max(5, Math.floor(parsedCDRs.length * 0.1)); // 10% or minimum 5
    if (invalidPhoneNumbers.length >= threshold) {
      sendAlert(
        `High Invalid Phone Number Count: ${invalidPhoneNumbers.length}`,
        `Found ${invalidPhoneNumbers.length} invalid phone numbers out of ${parsedCDRs.length} total records.\n\nExamples:\n${invalidPhoneNumbers.slice(0, 10).join('\n')}\n\n${invalidPhoneNumbers.length > 10 ? `... and ${invalidPhoneNumbers.length - 10} more` : ''}`
      );
    } else {
      console.warn(`Found ${invalidPhoneNumbers.length} invalid phone numbers (below alert threshold of ${threshold})`);
    }
  }
  
  return processedRecords;
}

function getPSTOffset(date) {
  // Calculate PST/PDT offset dynamically
  const utc = new Date(date.getTime() + (date.getTimezoneOffset() * 60000));
  const pst = new Date(utc.getTime() + (-8 * 3600000)); // PST is UTC-8

  // Check for daylight saving time (rough approximation)
  const isDST = date.getTimezoneOffset() < new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  return isDST ? -7 : -8; // PDT is UTC-7, PST is UTC-8
}

function cleanPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return null;

  // Remove all non-numeric characters (strips +, -, spaces, parentheses, etc.)
  let cleaned = phone.replace(/\D/g, '');

  // Handle empty or invalid cases
  if (!cleaned || cleaned.length === 0) return null;

  // Remove leading 1 if we have 11 digits (North American format)
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    cleaned = cleaned.substring(1);
  }

  // Only accept 10-digit numbers
  if (cleaned.length === 10) {
    // Validate it's a reasonable phone number (not all zeros, etc.)
    if (cleaned === '0000000000' || cleaned === '1111111111') {
      return null;
    }

    // First digit should be 2-9 for valid North American numbers
    if (cleaned.charAt(0) >= '2' && cleaned.charAt(0) <= '9') {
      return cleaned;
    }
  }

  // Log problematic numbers for debugging (but don't fail processing)
  if (cleaned.length !== 10) {
    console.warn(`Invalid phone number length (${cleaned.length} digits): ${phone} -> ${cleaned}`);
  }

  return null;
}

function SaveCDRFiles(processedCDRs, cdrfilename) {
  let cOutput = JSON.stringify(processedCDRs, null, 2);

  fs.writeFile(
    "./bak/" + cdrfilename,
    cOutput,
    async (err) => {
      if (err) {
        console.error(`Error saving backup file ${cdrfilename}:`, err);
        await sendAlert(`CDR Backup Failed: ${cdrfilename}`, err.message);
        return;
      }
      console.log(`Backup file saved: ${cdrfilename}`);
      await WriteToSQL(processedCDRs, cdrfilename);
    }
  );
}

async function WriteToSQL(processedData, filename) {
  try {
    console.log(`Writing ${processedData.length} records to SQL for file: ${filename}`);

    const pool = await sql.connect(dbconfig);
    const request = pool.request();

    request.input('cdrData', sql.NVarChar(sql.MAX), JSON.stringify(processedData));
    request.input('filename', sql.NVarChar(255), filename);
    request.output('recordCount', sql.Int);

    const result = await request.execute('VI_StoreCDRs');

    console.log(`Successfully processed ${result.output.recordCount} records from ${filename}`);

    // Clean up backup file after successful processing (optional)
    // Uncomment if you want to delete backup files after successful processing
    /*
    try {
        fs.unlinkSync(`./bak/${filename}`);
        console.log(`Cleaned up backup file: ${filename}`);
    } catch (cleanupErr) {
        console.warn(`Could not delete backup file ${filename}:`, cleanupErr.message);
    }
    */

  } catch (error) {
    console.error(`Error processing ${filename}:`, error);
    await sendAlert(`CDR Processing Failed: ${filename}`, error.message);
    throw error;
  } finally {
    await sql.close();
  }
}

async function sendAlert(subject, message) {
  // Log to console for immediate visibility
  console.error(`ALERT: ${subject} - ${message}`);

  // Send email alert if SMTP is configured
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.ALERT_EMAIL_TO) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      });

      const mailOptions = {
        from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER,
        to: process.env.ALERT_EMAIL_TO,
        subject: `CDR System Alert: ${subject}`,
        text: `CDR Processing Alert\n\nSubject: ${subject}\n\nDetails:\n${message}\n\nTimestamp: ${new Date().toISOString()}\n\nThis is an automated alert from the VoIP Innovations CDR processing system.`,
        html: `
          <h2>CDR Processing Alert</h2>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Details:</strong></p>
          <pre>${message}</pre>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          <hr>
          <p><em>This is an automated alert from the VoIP Innovations CDR processing system.</em></p>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log(`Alert email sent successfully to ${process.env.ALERT_EMAIL_TO}`);
      
    } catch (emailError) {
      console.error('Failed to send alert email:', emailError.message);
      // Don't throw error - we don't want email failures to stop CDR processing
    }
  } else {
    console.warn('SMTP not configured - alert email not sent');
  }
}