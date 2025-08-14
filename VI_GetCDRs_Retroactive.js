/**
 * Retroactive CDR Processing Script
 * Downloads and processes CDRs for a specific date or date range
 * 
 * Usage:
 *   node VI_GetCDRs_Retroactive.js 2025-01-13
 *   node VI_GetCDRs_Retroactive.js 2025-01-13 2025-01-15
 * 
 * Enhanced with service number support for emergency calls (911) and directory assistance (411)
 * + FTP connection optimization (eliminates failed connection attempts)
 */

require('dotenv').config();

const ftp = require("basic-ftp");
const fs = require("fs");
const Papa = require("papaparse");
const sql = require("mssql");
const nodemailer = require("nodemailer");

// Get command line arguments for date processing
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node VI_GetCDRs_Retroactive.js <start-date> [end-date]');
  console.error('Date format: YYYY-MM-DD');
  console.error('Examples:');
  console.error('  node VI_GetCDRs_Retroactive.js 2025-01-13');
  console.error('  node VI_GetCDRs_Retroactive.js 2025-01-13 2025-01-15');
  process.exit(1);
}

const startDate = new Date(args[0]);
const endDate = args[1] ? new Date(args[1]) : startDate;

if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
  console.error('Invalid date format. Use YYYY-MM-DD');
  process.exit(1);
}

if (startDate > endDate) {
  console.error('Start date must be before or equal to end date');
  process.exit(1);
}

console.log(`Processing CDRs from ${startDate.toDateString()} to ${endDate.toDateString()}`);

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

// Service number validation utilities (from enhanced version)
const VALID_SERVICE_NUMBERS = ['911', '411', '511', '611', '711', '811'];

function isValidServiceNumber(number) {
  return VALID_SERVICE_NUMBERS.includes(number);
}

function createProcessingStats() {
  return {
    totalProcessed: 0,
    tenDigitNumbers: 0,
    serviceNumbers: 0,
    invalidNumbers: 0,
    serviceNumberBreakdown: {
      '911': 0, '411': 0, '511': 0, '611': 0, '711': 0, '811': 0
    },
    invalidExamples: [],
    invalidCategories: {
      'international': 0, 'shortCodes': 0, 'invalidLength': 0,
      'invalidPattern': 0, 'invalidAreaCode': 0
    },
    processingStartTime: new Date(),
    uniqueNumbers: new Set()
  };
}

function cleanPhoneNumber(phone, stats = null) {
  if (!phone || typeof phone !== 'string') return null;
  let cleaned = phone.replace(/\D/g, '');
  if (!cleaned || cleaned.length === 0) return null;

  // Handle 3-digit service numbers
  if (cleaned.length === 3) {
    if (isValidServiceNumber(cleaned)) {
      if (stats) {
        stats.serviceNumbers++;
        stats.serviceNumberBreakdown[cleaned]++;
        stats.totalProcessed++;
        stats.uniqueNumbers.add(cleaned);
      }
      return cleaned;
    } else {
      console.warn(`Invalid 3-digit service number: ${phone} -> ${cleaned}`);
      if (stats) {
        stats.invalidNumbers++;
        stats.totalProcessed++;
        stats.invalidCategories.shortCodes++;
        if (stats.invalidExamples.length < 10) {
          stats.invalidExamples.push(`Invalid 3-digit: ${phone}`);
        }
      }
      return null;
    }
  }

  // Remove leading 1 if we have 11 digits
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    cleaned = cleaned.substring(1);
  }

  // Handle 10-digit numbers
  if (cleaned.length === 10) {
    if (cleaned === '0000000000' || cleaned === '1111111111') {
      if (stats) {
        stats.invalidNumbers++;
        stats.totalProcessed++;
        stats.invalidCategories.invalidPattern++;
        if (stats.invalidExamples.length < 10) {
          stats.invalidExamples.push(`Invalid pattern: ${phone}`);
        }
      }
      return null;
    }

    if (cleaned.charAt(0) >= '2' && cleaned.charAt(0) <= '9') {
      if (stats) {
        stats.tenDigitNumbers++;
        stats.totalProcessed++;
        stats.uniqueNumbers.add(cleaned);
      }
      return cleaned;
    } else {
      if (stats) {
        stats.invalidNumbers++;
        stats.totalProcessed++;
        stats.invalidCategories.invalidAreaCode++;
        if (stats.invalidExamples.length < 10) {
          stats.invalidExamples.push(`Invalid area code: ${phone}`);
        }
      }
      return null;
    }
  }

  // Invalid length
  if (stats) {
    stats.invalidNumbers++;
    stats.totalProcessed++;
    if (cleaned.length > 10) {
      stats.invalidCategories.international++;
    } else if (cleaned.length >= 4 && cleaned.length <= 6) {
      stats.invalidCategories.shortCodes++;
    } else {
      stats.invalidCategories.invalidLength++;
    }
    if (stats.invalidExamples.length < 10) {
      stats.invalidExamples.push(`Invalid length (${cleaned.length}): ${phone}`);
    }
  }
  return null;
}

// Enhanced processing function (simplified version of the main one)
function processAndCleanCDRs(parsedCDRs) {
  const processingStats = createProcessingStats();
  let invalidPhoneNumbers = [];

  const processedRecords = parsedCDRs.map(record => {
    try {
      // Timezone conversion (PST offset)
      let startTime = null;
      if (record.StartTime) {
        startTime = new Date(record.StartTime);
        const pstOffset = getPSTOffset(startTime);
        startTime.setHours(startTime.getHours() + pstOffset);
      }

      // Clean phone numbers with statistics collection
      let ani = cleanPhoneNumber(record.ANI, processingStats);
      let dnis = cleanPhoneNumber(record.DNIS, processingStats);

      // Track invalid phone numbers for alerting (excluding valid service numbers)
      if (!ani && record.ANI) {
        const cleanedANI = record.ANI.replace(/\D/g, '');
        if (cleanedANI.length !== 3 || !isValidServiceNumber(cleanedANI)) {
          invalidPhoneNumbers.push(`ANI: ${record.ANI}`);
        }
      }
      if (!dnis && record.DNIS) {
        const cleanedDNIS = record.DNIS.replace(/\D/g, '');
        if (cleanedDNIS.length !== 3 || !isValidServiceNumber(cleanedDNIS)) {
          invalidPhoneNumbers.push(`DNIS: ${record.DNIS}`);
        }
      }

      return {
        StartTime: startTime ? startTime.toISOString() : null,
        BillDuration: parseInt(record.BillDuration) || 0,
        CallPrice: parseFloat(record.CallPrice) || 0.0,
        ANI: ani,
        DNIS: dnis,
        CustomerIP: record.CustomerIP || '',
        CallType: record.CallType || '',
        LRN: record.LRN || ''
      };
    } catch (err) {
      console.warn(`Error processing record:`, err, record);
      return null;
    }
  }).filter(record => record !== null);

  // Log processing statistics
  console.log(`\n=== Phone Number Processing Statistics ===`);
  console.log(`Total phone numbers processed: ${processingStats.totalProcessed}`);
  console.log(`10-digit numbers: ${processingStats.tenDigitNumbers}`);
  console.log(`Service numbers: ${processingStats.serviceNumbers}`);
  console.log(`Invalid numbers: ${processingStats.invalidNumbers}`);

  if (processingStats.serviceNumbers > 0) {
    console.log(`\nService Number Breakdown:`);
    Object.entries(processingStats.serviceNumberBreakdown).forEach(([number, count]) => {
      if (count > 0) {
        let description = '';
        switch (number) {
          case '911': description = 'Emergency services'; break;
          case '411': description = 'Directory assistance'; break;
          case '511': description = 'Traffic information'; break;
          case '611': description = 'Repair service'; break;
          case '711': description = 'Telecommunications relay'; break;
          case '811': description = 'Utility location'; break;
        }
        console.log(`  ${number} (${description}): ${count} calls`);
      }
    });
  }

  return processedRecords;
}

function getPSTOffset(date) {
  const isDST = date.getTimezoneOffset() < new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  return isDST ? -7 : -8;
}

// Generate date range
function getDateRange(start, end) {
  const dates = [];
  const current = new Date(start);

  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

// Format date for folder name (YYYYMMDD)
function formatDateForFolder(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return yyyy + mm + dd;
}

// Download CDRs for a specific date
async function downloadCDRsForDate(date) {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  
  // Configure timeouts and passive mode
  client.ftp.timeout = 30000; // 30 second timeout
  client.ftp.ipFamily = 4; // Force IPv4

  const folderName = formatDateForFolder(date);
  console.log(`\n=== Processing ${date.toDateString()} (folder: ${folderName}) ===`);

  try {
    console.log(`Attempting FTP connection to ${process.env.FTP_HOST} (secure: ${process.env.FTP_SECURE})`);
    
    // Check if optimized connection is enabled (default: true)
    const useOptimizedConnection = process.env.FTP_OPTIMIZED_CONNECTION !== 'false';
    
    if (useOptimizedConnection) {
      // Use the proven working connection method directly
      console.log(`🔐 Connecting using standard FTPS on port 21 (optimized mode)...`);
      
      try {
        await client.access({
          host: process.env.FTP_HOST,
          user: process.env.FTP_USER,
          password: process.env.FTP_PASSWORD,
          secure: true,
          port: 21,
          secureOptions: {
            rejectUnauthorized: false,
            checkServerIdentity: () => undefined,
            servername: process.env.FTP_HOST
          }
        });
        console.log(`✅ Standard FTPS connection established`);
        
        // Configure passive mode settings after connection
        client.ftp.pasv = true; // Enable passive mode
      } catch (connectionError) {
        console.error(`❌ FTPS connection failed: ${connectionError.message}`);
        throw new Error(`Failed to establish FTPS connection: ${connectionError.message}`);
      }
    } else {
      // Legacy mode: Try multiple connection approaches
      console.log(`🔐 Using legacy connection mode with multiple attempts...`);
      let connected = false;
      
      // Approach 1: Explicit FTPS (STARTTLS on port 21)
      if (!connected) {
        try {
          console.log(`🔐 Trying explicit FTPS (STARTTLS)...`);
          await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: "explicit",
            secureOptions: {
              rejectUnauthorized: false,
              checkServerIdentity: () => undefined
            }
          });
          console.log(`✅ Explicit FTPS connection established`);
          connected = true;
        } catch (explicitError) {
          console.log(`⚠️  Explicit FTPS failed: ${explicitError.message}`);
        }
      }
      
      // Approach 2: Implicit FTPS (SSL from start, usually port 990)
      if (!connected) {
        try {
          console.log(`🔐 Trying implicit FTPS...`);
          await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: true,
            port: 990,
            secureOptions: {
              rejectUnauthorized: false,
              checkServerIdentity: () => undefined
            }
          });
          console.log(`✅ Implicit FTPS connection established`);
          connected = true;
        } catch (implicitError) {
          console.log(`⚠️  Implicit FTPS failed: ${implicitError.message}`);
        }
      }
      
      // Approach 3: Standard FTPS on port 21
      if (!connected) {
        try {
          console.log(`🔐 Trying standard FTPS on port 21...`);
          await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: true,
            port: 21,
            secureOptions: {
              rejectUnauthorized: false,
              checkServerIdentity: () => undefined,
              servername: process.env.FTP_HOST
            }
          });
          console.log(`✅ Standard FTPS connection established`);
          
          // Configure passive mode settings after connection
          client.ftp.pasv = true; // Enable passive mode
          connected = true;
        } catch (standardError) {
          console.log(`⚠️  Standard FTPS failed: ${standardError.message}`);
        }
      }
      
      if (!connected) {
        throw new Error("All FTPS connection methods failed");
      }
    }

    console.log(`Connecting to FTP folder: /${folderName}/`);
    
    try {
      await client.cd("/" + folderName + "/");
    } catch (cdError) {
      console.log(`⚠️  Folder /${folderName}/ not found or inaccessible: ${cdError.message}`);
      client.close();
      return null;
    }

    // Create date-specific directory
    const dateDir = `./cdrs/${folderName}`;
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }

    // Try download with retry logic for passive mode issues
    let downloadSuccess = false;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (!downloadSuccess && retryCount < maxRetries) {
      try {
        console.log(`📥 Attempting download (attempt ${retryCount + 1}/${maxRetries})...`);
        await client.downloadToDir(dateDir);
        downloadSuccess = true;
        console.log(`✅ Downloaded CDRs for ${date.toDateString()}`);
      } catch (downloadError) {
        retryCount++;
        console.log(`⚠️  Download attempt ${retryCount} failed: ${downloadError.message}`);
        
        if (retryCount < maxRetries) {
          console.log(`🔄 Retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Try switching to active mode for retry
          if (retryCount === 2) {
            console.log(`🔄 Switching to active mode for retry...`);
            client.ftp.pasv = false;
          }
        } else {
          throw downloadError;
        }
      }
    }

    client.close();
    return dateDir;

  } catch (err) {
    console.error(`❌ Failed to download CDRs for ${date.toDateString()}:`, err.message);
    client.close();
    return null;
  }
}

// Process CDRs from a directory
async function processCDRsFromDirectory(directory, date) {
  try {
    const filenames = fs.readdirSync(directory);
    console.log(`Found ${filenames.length} files in ${directory}`);

    if (filenames.length === 0) {
      console.log(`⚠️  No CDR files found for ${date.toDateString()}`);
      return;
    }

    for (const file of filenames) {
      console.log(`Processing file: ${file}`);
      const filePath = `${directory}/${file}`;

      try {
        const cdrfile = fs.readFileSync(filePath, "utf8");
        const config = {
          delimiter: ";",
          header: true,
          skipEmptyLines: true,
        };

        const parcdr = Papa.parse(cdrfile, config);
        const parsedCDRs = parcdr.data;

        console.log(`Parsed ${parsedCDRs.length} CDR records from ${file}`);

        // Process and clean the CDR data with service number support
        const processedCDRs = processAndCleanCDRs(parsedCDRs);
        console.log(`Processed ${processedCDRs.length} CDR records`);

        // Save processed data
        const backupFile = `./bak/${formatDateForFolder(date)}_${file}`;
        const cOutput = JSON.stringify(processedCDRs, null, 2);
        fs.writeFileSync(backupFile, cOutput);
        console.log(`✅ Backup saved: ${backupFile}`);

        // Write to SQL
        try {
          await WriteToSQL(processedCDRs, file);
          console.log(`✅ Database insertion completed for ${file}`);
        } catch (dbError) {
          console.error(`❌ Database insertion failed for ${file}:`, dbError.message);
          console.log(`💾 Data is still available in backup file: ${backupFile}`);
        }

        // Clean up original file
        fs.unlinkSync(filePath);
        console.log(`🗑️  Cleaned up: ${filePath}`);

      } catch (parseError) {
        console.error(`❌ Error processing ${file}:`, parseError.message);
      }
    }

    // Remove empty directory
    try {
      fs.rmdirSync(directory);
    } catch (e) {
      // Directory not empty or other issue, ignore
    }

  } catch (err) {
    console.error(`❌ Error processing directory ${directory}:`, err.message);
  }
}

// Write to SQL (same as original but with error handling)
async function WriteToSQL(processedData, filename) {
  try {
    console.log(`Writing ${processedData.length} records to SQL for file: ${filename}`);

    const pool = await sql.connect(dbconfig);
    const request = pool.request();

    request.input('cdrData', sql.NVarChar(sql.MAX), JSON.stringify(processedData));
    request.input('filename', sql.NVarChar(255), filename);
    request.output('recordCount', sql.Int);

    const result = await request.execute('VI_StoreCDRs');

    console.log(`✅ Successfully processed ${result.output.recordCount} records from ${filename}`);

  } catch (error) {
    console.error(`❌ Error processing ${filename}:`, error.message);
    throw error;
  } finally {
    await sql.close();
  }
}

// Main processing function
async function processRetroactiveCDRs() {
  console.log('🚀 Starting retroactive CDR processing...');
  console.log(`📅 Date range: ${startDate.toDateString()} to ${endDate.toDateString()}`);

  // Safety confirmation
  console.log('\n⚠️  WARNING: This script will:');
  console.log('   1. Download CDR files from VoIP Innovations FTP server');
  console.log('   2. Process them with enhanced service number support');
  console.log('   3. Write processed data to your SQL database using VI_StoreCDRs');
  console.log('   4. Create backup JSON files in ./bak/ directory');
  console.log('   Make sure your .env file is properly configured!\n');

  const dates = getDateRange(startDate, endDate);
  console.log(`📊 Total dates to process: ${dates.length}`);

  let successCount = 0;
  let errorCount = 0;

  for (const date of dates) {
    try {
      // Download CDRs for this date
      const downloadDir = await downloadCDRsForDate(date);

      if (downloadDir) {
        // Process the downloaded CDRs
        await processCDRsFromDirectory(downloadDir, date);
        successCount++;
      } else {
        errorCount++;
      }

      // Small delay between dates to be nice to the FTP server
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`❌ Error processing ${date.toDateString()}:`, error.message);
      errorCount++;
    }
  }

  console.log('\n🎉 Retroactive processing complete!');
  console.log(`✅ Successfully processed: ${successCount} dates`);
  console.log(`❌ Errors encountered: ${errorCount} dates`);

  if (successCount > 0) {
    console.log('\n📋 Next steps:');
    console.log('1. Review the backup files in ./bak/ directory');
    console.log('2. Uncomment the WriteToSQL() call to insert data into database');
    console.log('3. Check for any service numbers (911, 411) that were preserved');
  }
}

// Run the retroactive processing
processRetroactiveCDRs().catch(console.error);