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

/**
 * Processes and cleans CDR data with enhanced service number support and statistics collection.
 * 
 * This function orchestrates the complete CDR processing pipeline, including phone number
 * cleaning, timezone conversion, data validation, and comprehensive statistics collection.
 * It handles both ANI (source) and DNIS (destination) phone numbers with full support
 * for 3-digit service numbers and detailed invalid number categorization.
 * 
 * @function processAndCleanCDRs
 * @param {Object[]} parsedCDRs - Array of parsed CDR records from CSV
 * @returns {Object[]} Array of processed CDR records with cleaned phone numbers
 * 
 * @description
 * Processing Pipeline:
 * 1. Initialize comprehensive statistics tracking
 * 2. Process each CDR record:
 *    - Convert timestamps to PST/PDT
 *    - Clean and validate ANI (source) phone numbers
 *    - Clean and validate DNIS (destination) phone numbers
 *    - Track invalid numbers (excluding valid service numbers)
 * 3. Generate detailed processing statistics and logs
 * 4. Send alerts if invalid number threshold exceeded
 * 5. Return processed records for database storage
 * 
 * Service Number Handling:
 * - Preserves all valid 3-digit service numbers (911, 411, 511, 611, 711, 811)
 * - Excludes service numbers from invalid phone number alerts
 * - Provides detailed breakdown of service number usage
 * - Tracks emergency calls (911) for compliance reporting
 * - Monitors directory assistance (411) for billing purposes
 * 
 * @since 2.1.0
 * @see {@link cleanPhoneNumber} for individual phone number processing
 * @see {@link createProcessingStats} for statistics object structure
 */
function processAndCleanCDRs(parsedCDRs) {
  // === INITIALIZATION PHASE ===
  // Create comprehensive statistics tracking object for detailed monitoring
  const processingStats = createProcessingStats();
  
  // Array to collect truly invalid phone numbers (excluding valid service numbers)
  // This is used for alert threshold calculations and prevents false positives
  let invalidPhoneNumbers = [];
  
  // Enhanced logging for service number processing initialization
  console.log(`\n=== Starting Phone Number Processing ===`);
  console.log(`Processing ${parsedCDRs.length} CDR records...`);
  console.log(`\n🚨 Service Number Detection Enabled:`);
  console.log(`  Monitoring for the following service numbers:`);
  VALID_SERVICE_NUMBERS.forEach(number => {
    let description = '';
    let importance = '';
    switch(number) {
      case '911': 
        description = 'Emergency services'; 
        importance = '(CRITICAL - Must be captured for compliance)';
        break;
      case '411': 
        description = 'Directory assistance'; 
        importance = '(BILLABLE - Revenue impact)';
        break;
      case '511': 
        description = 'Traffic information'; 
        importance = '(INFO - Public service)';
        break;
      case '611': 
        description = 'Repair service'; 
        importance = '(SUPPORT - Customer service)';
        break;
      case '711': 
        description = 'Telecommunications relay'; 
        importance = '(ACCESSIBILITY - ADA compliance)';
        break;
      case '811': 
        description = 'Utility location'; 
        importance = '(SAFETY - Infrastructure protection)';
        break;
    }
    console.log(`    ${number} - ${description} ${importance}`);
  });
  
  console.log(`\n📊 Processing Configuration:`);
  console.log(`  10-digit number validation: Enabled`);
  console.log(`  3-digit service number support: Enabled`);
  console.log(`  Invalid number categorization: Enabled`);
  console.log(`  Debug logging: ${process.env.LOG_LEVEL === 'debug' || process.env.LOG_SERVICE_NUMBER_DETAILS === 'true' ? 'Enabled' : 'Disabled'}`);
  console.log(`  Statistics collection: Enabled`);
  console.log(`=== Processing Started ===\n`);

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

      // Clean phone numbers with statistics collection
      let ani = cleanPhoneNumber(record.ANI, processingStats);
      let dnis = cleanPhoneNumber(record.DNIS, processingStats);

      // Track invalid phone numbers for alerting (excluding valid service numbers)
      if (!ani && record.ANI) {
        // Only add to invalid list if it's not a valid service number
        const cleanedANI = record.ANI.replace(/\D/g, '');
        if (cleanedANI.length !== 3 || !isValidServiceNumber(cleanedANI)) {
          invalidPhoneNumbers.push(`ANI: ${record.ANI}`);
        }
      }
      if (!dnis && record.DNIS) {
        // Only add to invalid list if it's not a valid service number
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
        LRN: record.LRN || '' // Keep for reference but don't use for DNIS
      };
    } catch (err) {
      console.warn(`Error processing record:`, err, record);
      return null;
    }
  }).filter(record => record !== null);

  // Enhanced processing statistics logging
  console.log(`\n=== Phone Number Processing Statistics ===`);
  console.log(`Total CDR records processed: ${parsedCDRs.length}`);
  console.log(`Total phone numbers processed: ${processingStats.totalProcessed}`);
  console.log(`Successfully processed: ${processingStats.tenDigitNumbers + processingStats.serviceNumbers} (${((processingStats.tenDigitNumbers + processingStats.serviceNumbers) / processingStats.totalProcessed * 100).toFixed(1)}%)`);
  console.log(`\nBreakdown by type:`);
  console.log(`  📞 10-digit numbers: ${processingStats.tenDigitNumbers} (${(processingStats.tenDigitNumbers / processingStats.totalProcessed * 100).toFixed(1)}%)`);
  console.log(`  🚨 Service numbers: ${processingStats.serviceNumbers} (${(processingStats.serviceNumbers / processingStats.totalProcessed * 100).toFixed(1)}%)`);
  console.log(`  ❌ Invalid numbers: ${processingStats.invalidNumbers} (${(processingStats.invalidNumbers / processingStats.totalProcessed * 100).toFixed(1)}%)`);

  // Enhanced service number processing summary
  if (processingStats.serviceNumbers > 0) {
    console.log(`\n🚨 Service Number Processing Summary:`);
    console.log(`  Total service numbers processed: ${processingStats.serviceNumbers}`);
    console.log(`  Service number success rate: 100% (all service numbers are valid by definition)`);
    console.log(`  Impact on data quality: Service numbers excluded from invalid count`);
    
    console.log(`\n🚨 Service Number Breakdown:`);
    Object.entries(processingStats.serviceNumberBreakdown).forEach(([number, count]) => {
      if (count > 0) {
        const percentage = (count / processingStats.serviceNumbers * 100).toFixed(1);
        const totalPercentage = (count / processingStats.totalProcessed * 100).toFixed(2);
        let description = '';
        let priority = '';
        switch (number) {
          case '911': 
            description = 'Emergency services'; 
            priority = 'CRITICAL - Emergency calls';
            break;
          case '411': 
            description = 'Directory assistance'; 
            priority = 'BILLABLE - Directory service';
            break;
          case '511': 
            description = 'Traffic information'; 
            priority = 'INFO - Traffic service';
            break;
          case '611': 
            description = 'Repair service'; 
            priority = 'SUPPORT - Repair service';
            break;
          case '711': 
            description = 'Telecommunications relay'; 
            priority = 'ACCESSIBILITY - Relay service';
            break;
          case '811': 
            description = 'Utility location'; 
            priority = 'SAFETY - Utility service';
            break;
        }
        console.log(`    ${number} (${description}):`);
        console.log(`      Count: ${count} calls`);
        console.log(`      Percentage of service numbers: ${percentage}%`);
        console.log(`      Percentage of total processed: ${totalPercentage}%`);
        console.log(`      Priority: ${priority}`);
      }
    });

    // Enhanced alerting for service number patterns
    console.log(`\n🚨 Service Number Analysis:`);
    
    // Emergency call analysis
    if (processingStats.serviceNumberBreakdown['911'] > 0) {
      const emergencyCount = processingStats.serviceNumberBreakdown['911'];
      console.log(`  🚨 Emergency calls (911): ${emergencyCount} detected`);
      if (emergencyCount > 10) {
        console.warn(`    ⚠️  HIGH VOLUME: ${emergencyCount} emergency calls (review for unusual activity)`);
      } else if (emergencyCount > 5) {
        console.warn(`    ⚠️  MODERATE VOLUME: ${emergencyCount} emergency calls (monitor trend)`);
      } else {
        console.log(`    ✅ Normal volume: ${emergencyCount} emergency calls`);
      }
    }
    
    // Directory assistance analysis
    if (processingStats.serviceNumberBreakdown['411'] > 0) {
      const directoryCount = processingStats.serviceNumberBreakdown['411'];
      console.log(`  📞 Directory assistance (411): ${directoryCount} detected`);
      if (directoryCount > 50) {
        console.warn(`    ⚠️  HIGH VOLUME: ${directoryCount} directory calls (verify billing)`);
      } else {
        console.log(`    ✅ Normal volume: ${directoryCount} directory calls`);
      }
    }
    
    // Other service numbers
    const otherServices = ['511', '611', '711', '811'];
    const otherCount = otherServices.reduce((sum, num) => sum + processingStats.serviceNumberBreakdown[num], 0);
    if (otherCount > 0) {
      console.log(`  🔧 Other service numbers: ${otherCount} detected`);
      console.log(`    ✅ Normal processing for utility and information services`);
    }
    
  } else {
    console.log(`\n✅ Service Number Processing Summary:`);
    console.log(`  No service numbers (911, 411, etc.) found in this batch`);
    console.log(`  All phone numbers processed as regular 10-digit numbers`);
    console.log(`  No special service number handling required`);
  }

  // Invalid number analysis with detailed categorization
  if (processingStats.invalidNumbers > 0) {
    console.log(`\n❌ Invalid Number Analysis:`);
    console.log(`  Total invalid: ${processingStats.invalidNumbers}`);

    // Show breakdown by category
    console.log(`  Invalid number categories:`);
    Object.entries(processingStats.invalidCategories).forEach(([category, count]) => {
      if (count > 0) {
        const percentage = (count / processingStats.invalidNumbers * 100).toFixed(1);
        let description = '';
        switch (category) {
          case 'international': description = 'International numbers'; break;
          case 'shortCodes': description = 'Short codes (4-6 digits)'; break;
          case 'invalidLength': description = 'Other invalid lengths'; break;
          case 'invalidPattern': description = 'Invalid patterns (all zeros, etc.)'; break;
          case 'invalidAreaCode': description = 'Invalid area codes (0/1 prefix)'; break;
        }
        console.log(`    ${description}: ${count} (${percentage}%)`);
      }
    });

    if (processingStats.invalidExamples.length > 0) {
      console.log(`  Sample invalid numbers:`);
      processingStats.invalidExamples.slice(0, 5).forEach((example, index) => {
        console.log(`    ${index + 1}. ${example}`);
      });
      if (processingStats.invalidExamples.length > 5) {
        console.log(`    ... and ${processingStats.invalidExamples.length - 5} more`);
      }
    }
  }

  // Processing efficiency metrics
  const processingEndTime = new Date();
  const processingDuration = processingEndTime - processingStats.processingStartTime;
  const successRate = ((processingStats.tenDigitNumbers + processingStats.serviceNumbers) / processingStats.totalProcessed * 100).toFixed(1);

  console.log(`\n📊 Processing Efficiency:`);
  console.log(`  Success rate: ${successRate}%`);
  console.log(`  Records with valid phone numbers: ${processedRecords.length}/${parsedCDRs.length}`);
  console.log(`  Unique phone numbers found: ${processingStats.uniqueNumbers.size}`);
  console.log(`  Processing time: ${processingDuration}ms`);
  console.log(`  Processing rate: ${(processingStats.totalProcessed / (processingDuration / 1000)).toFixed(0)} numbers/second`);

  if (successRate < 95) {
    console.warn(`⚠️  Phone number success rate below 95% - review data quality`);
  }

  if (processingStats.uniqueNumbers.size < processingStats.totalProcessed * 0.1) {
    console.warn(`⚠️  Low unique number diversity - possible data quality issue`);
  }

  // Final service number processing summary
  console.log(`\n🚨 Final Service Number Processing Report:`);
  if (processingStats.serviceNumbers > 0) {
    console.log(`  ✅ Service numbers successfully processed and preserved`);
    console.log(`  ✅ Emergency calls (911) captured for compliance: ${processingStats.serviceNumberBreakdown['911']}`);
    console.log(`  ✅ Directory assistance (411) captured for billing: ${processingStats.serviceNumberBreakdown['411']}`);
    console.log(`  ✅ All service numbers excluded from invalid phone number alerts`);
    console.log(`  ✅ Service number data will be stored in database with original format`);
  } else {
    console.log(`  ℹ️  No service numbers found in this batch`);
    console.log(`  ℹ️  All phone numbers processed as regular 10-digit numbers`);
  }
  
  // Debug logging summary
  if (process.env.LOG_LEVEL === 'debug' || process.env.LOG_SERVICE_NUMBER_DETAILS === 'true') {
    console.log(`\n🔍 Debug Logging Summary:`);
    console.log(`  Debug mode: Active`);
    console.log(`  Individual service number detections logged above`);
    console.log(`  Enhanced validation decision logging enabled`);
  }
  
  console.log(`=== End Processing Statistics ===\n`);

  // Enhanced alert logic for invalid phone numbers
  // Use corrected invalid count (excluding valid service numbers)
  if (invalidPhoneNumbers.length > 0) {
    const threshold = Math.max(5, Math.floor(parsedCDRs.length * 0.1)); // 10% or minimum 5
    const invalidRate = (invalidPhoneNumbers.length / parsedCDRs.length * 100).toFixed(1);

    if (invalidPhoneNumbers.length >= threshold) {
      // Build detailed alert message with enhanced statistics
      let alertMessage = `CDR Processing Alert - High Invalid Phone Number Count\n\n`;
      alertMessage += `SUMMARY:\n`;
      alertMessage += `- Total CDR records: ${parsedCDRs.length}\n`;
      alertMessage += `- Invalid phone numbers: ${invalidPhoneNumbers.length} (${invalidRate}%)\n`;
      alertMessage += `- Alert threshold: ${threshold} (${(threshold / parsedCDRs.length * 100).toFixed(1)}%)\n\n`;

      alertMessage += `PROCESSING STATISTICS:\n`;
      alertMessage += `- 10-digit numbers: ${processingStats.tenDigitNumbers}\n`;
      alertMessage += `- Service numbers: ${processingStats.serviceNumbers}\n`;
      alertMessage += `- Total invalid: ${processingStats.invalidNumbers}\n`;
      alertMessage += `- Corrected invalid (excluding service numbers): ${invalidPhoneNumbers.length}\n\n`;

      // Service number breakdown if any found
      if (processingStats.serviceNumbers > 0) {
        alertMessage += `SERVICE NUMBERS FOUND (excluded from invalid count):\n`;
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
            alertMessage += `- ${number} (${description}): ${count} calls\n`;
          }
        });
        alertMessage += `\n`;
      }

      // Invalid number categorization
      if (Object.values(processingStats.invalidCategories).some(count => count > 0)) {
        alertMessage += `INVALID NUMBER CATEGORIES:\n`;
        Object.entries(processingStats.invalidCategories).forEach(([category, count]) => {
          if (count > 0) {
            let description = '';
            switch (category) {
              case 'international': description = 'International numbers'; break;
              case 'shortCodes': description = 'Short codes (4-6 digits)'; break;
              case 'invalidLength': description = 'Other invalid lengths'; break;
              case 'invalidPattern': description = 'Invalid patterns (all zeros, etc.)'; break;
              case 'invalidAreaCode': description = 'Invalid area codes (0/1 prefix)'; break;
            }
            alertMessage += `- ${description}: ${count}\n`;
          }
        });
        alertMessage += `\n`;
      }

      alertMessage += `SAMPLE INVALID NUMBERS:\n`;
      invalidPhoneNumbers.slice(0, 10).forEach((example, index) => {
        alertMessage += `${index + 1}. ${example}\n`;
      });
      if (invalidPhoneNumbers.length > 10) {
        alertMessage += `... and ${invalidPhoneNumbers.length - 10} more\n`;
      }

      alertMessage += `\nRECOMMENDATIONS:\n`;
      alertMessage += `- Review data source quality\n`;
      alertMessage += `- Check for format changes in CDR files\n`;
      alertMessage += `- Verify international number handling if applicable\n`;
      alertMessage += `- Consider updating phone number validation rules if needed`;

      sendAlert(
        `High Invalid Phone Number Count: ${invalidPhoneNumbers.length} (${invalidRate}%)`,
        alertMessage
      );
    } else {
      console.warn(`Found ${invalidPhoneNumbers.length} invalid phone numbers (${invalidRate}% - below alert threshold of ${threshold})`);
    }
  } else {
    console.log(`✅ No invalid phone numbers found - all numbers processed successfully`);
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

// Service number validation utilities

/**
 * Array of valid 3-digit North American service numbers that should be preserved
 * during phone number processing. These numbers represent critical services that
 * must be captured for compliance, billing, and operational purposes.
 * 
 * @constant {string[]} VALID_SERVICE_NUMBERS
 * @readonly
 * 
 * Service Number Definitions:
 * - 911: Emergency services (CRITICAL - Required for regulatory compliance)
 * - 411: Directory assistance (BILLABLE - Revenue generating service)
 * - 511: Traffic information (PUBLIC SERVICE - Transportation information)
 * - 611: Repair service (CUSTOMER SUPPORT - Telecommunications repair)
 * - 711: Telecommunications relay (ACCESSIBILITY - ADA compliance service)
 * - 811: Utility location (SAFETY - Call before you dig service)
 * 
 * @since 2.1.0
 */
const VALID_SERVICE_NUMBERS = ['911', '411', '511', '611', '711', '811'];

/**
 * Validates if a 3-digit number is a recognized North American service number.
 * 
 * This function performs a simple lookup against the VALID_SERVICE_NUMBERS array
 * to determine if a cleaned 3-digit number represents a legitimate service that
 * should be preserved in the CDR processing pipeline.
 * 
 * @function isValidServiceNumber
 * @param {string} number - The 3-digit number to validate (must be exactly 3 digits)
 * @returns {boolean} true if the number is a valid service number, false otherwise
 * 
 * @example
 * // Valid service numbers
 * isValidServiceNumber('911') // returns true (Emergency services)
 * isValidServiceNumber('411') // returns true (Directory assistance)
 * isValidServiceNumber('511') // returns true (Traffic information)
 * 
 * @example
 * // Invalid service numbers
 * isValidServiceNumber('123') // returns false (Not a recognized service)
 * isValidServiceNumber('999') // returns false (Not a recognized service)
 * isValidServiceNumber('000') // returns false (Not a recognized service)
 * 
 * @example
 * // Edge cases
 * isValidServiceNumber('91')   // returns false (Wrong length)
 * isValidServiceNumber('9111') // returns false (Wrong length)
 * isValidServiceNumber(null)   // returns false (Invalid input)
 * 
 * @since 2.1.0
 * @see {@link VALID_SERVICE_NUMBERS} for the complete list of valid service numbers
 */
function isValidServiceNumber(number) {
  return VALID_SERVICE_NUMBERS.includes(number);
}

/**
 * Creates and initializes a comprehensive processing statistics tracking object.
 * 
 * This function returns a statistics object that tracks detailed metrics about
 * phone number processing, including counts by type, invalid number categorization,
 * performance metrics, and unique number tracking. The object is designed to be
 * passed to the cleanPhoneNumber function to collect statistics during processing.
 * 
 * @function createProcessingStats
 * @returns {ProcessingStats} A fully initialized statistics tracking object
 * 
 * @typedef {Object} ProcessingStats
 * @property {number} totalProcessed - Total count of phone numbers processed
 * @property {number} tenDigitNumbers - Count of valid 10-digit phone numbers
 * @property {number} serviceNumbers - Count of valid 3-digit service numbers
 * @property {number} invalidNumbers - Count of invalid/rejected phone numbers
 * @property {Object} serviceNumberBreakdown - Detailed count by service number type
 * @property {number} serviceNumberBreakdown.911 - Count of emergency service calls
 * @property {number} serviceNumberBreakdown.411 - Count of directory assistance calls
 * @property {number} serviceNumberBreakdown.511 - Count of traffic information calls
 * @property {number} serviceNumberBreakdown.611 - Count of repair service calls
 * @property {number} serviceNumberBreakdown.711 - Count of telecommunications relay calls
 * @property {number} serviceNumberBreakdown.811 - Count of utility location calls
 * @property {string[]} invalidExamples - Array of sample invalid phone numbers (max 10)
 * @property {Object} invalidCategories - Categorization of invalid numbers by type
 * @property {number} invalidCategories.international - Count of international numbers
 * @property {number} invalidCategories.shortCodes - Count of invalid short codes
 * @property {number} invalidCategories.invalidLength - Count of wrong-length numbers
 * @property {number} invalidCategories.invalidPattern - Count of invalid patterns (all zeros, etc.)
 * @property {number} invalidCategories.invalidAreaCode - Count of invalid area codes
 * @property {Date} processingStartTime - Timestamp when processing began
 * @property {Set<string>} uniqueNumbers - Set of unique phone numbers encountered
 * 
 * @example
 * // Create statistics object and use with phone number processing
 * const stats = createProcessingStats();
 * const cleanedNumber = cleanPhoneNumber('911', stats);
 * console.log(stats.serviceNumbers); // 1
 * console.log(stats.serviceNumberBreakdown['911']); // 1
 * 
 * @example
 * // Access processing metrics after completion
 * const stats = createProcessingStats();
 * // ... process many numbers ...
 * const processingTime = new Date() - stats.processingStartTime;
 * const successRate = (stats.tenDigitNumbers + stats.serviceNumbers) / stats.totalProcessed;
 * 
 * @since 2.1.0
 * @see {@link cleanPhoneNumber} for usage with phone number processing
 */
function createProcessingStats() {
  return {
    totalProcessed: 0,
    tenDigitNumbers: 0,
    serviceNumbers: 0,
    invalidNumbers: 0,
    serviceNumberBreakdown: {
      '911': 0,  // Emergency services
      '411': 0,  // Directory assistance
      '511': 0,  // Traffic information
      '611': 0,  // Repair service
      '711': 0,  // Telecommunications relay
      '811': 0   // Utility location
    },
    invalidExamples: [],
    // Enhanced invalid number categorization for better troubleshooting
    invalidCategories: {
      'international': 0,      // Numbers with country codes (11+ digits)
      'shortCodes': 0,         // Invalid short codes (4-6 digits)
      'invalidLength': 0,      // Other invalid lengths (1-2, 7-9 digits)
      'invalidPattern': 0,     // Invalid patterns (all zeros, all ones, etc.)
      'invalidAreaCode': 0     // Invalid area codes (starting with 0 or 1)
    },
    processingStartTime: new Date(),  // For performance tracking
    uniqueNumbers: new Set()          // Track unique phone numbers processed
  };
}

/**
 * Cleans and validates phone numbers with comprehensive support for both 10-digit 
 * regular numbers and 3-digit emergency/service numbers.
 * 
 * This is the core phone number processing function that handles the complete
 * validation pipeline for CDR data. It normalizes input formats, validates
 * against North American numbering plan rules, preserves critical service numbers,
 * and provides detailed statistics collection for monitoring and troubleshooting.
 * 
 * @function cleanPhoneNumber
 * @param {string} phone - Raw phone number in any format (with or without formatting)
 * @param {ProcessingStats} [stats=null] - Optional statistics object to collect processing metrics
 * @returns {string|null} Cleaned phone number string or null if invalid
 * 
 * @description
 * Processing Logic:
 * 1. Input validation (null, undefined, non-string inputs rejected)
 * 2. Character normalization (removes all non-numeric characters)
 * 3. Length-based routing:
 *    - 3 digits: Service number validation against whitelist
 *    - 11 digits starting with '1': North American format, strip leading 1
 *    - 10 digits: Standard phone number validation
 *    - Other lengths: Categorized as invalid with detailed classification
 * 
 * Supported 3-digit service numbers:
 * - 911 (Emergency services) - CRITICAL for compliance
 * - 411 (Directory assistance) - BILLABLE service
 * - 511 (Traffic information) - Public service
 * - 611 (Repair service) - Customer support
 * - 711 (Telecommunications relay) - Accessibility service
 * - 811 (Utility location) - Safety service
 * 
 * 10-digit number validation rules:
 * - First digit must be 2-9 (valid North American area code)
 * - Cannot be all zeros (0000000000) or all ones (1111111111)
 * - Must be exactly 10 digits after normalization
 * 
 * @example
 * // Basic service number processing
 * cleanPhoneNumber('911')           // → '911'
 * cleanPhoneNumber('411')           // → '411'
 * cleanPhoneNumber('123')           // → null (invalid service number)
 * 
 * @example
 * // Formatted service numbers
 * cleanPhoneNumber('9-1-1')         // → '911'
 * cleanPhoneNumber('4.1.1')         // → '411'
 * cleanPhoneNumber(' 911 ')         // → '911'
 * cleanPhoneNumber('(911)')         // → '911'
 * 
 * @example
 * // 10-digit number processing
 * cleanPhoneNumber('5551234567')              // → '5551234567'
 * cleanPhoneNumber('(555) 123-4567')          // → '5551234567'
 * cleanPhoneNumber('+1-555-123-4567')         // → '5551234567'
 * cleanPhoneNumber('1.555.123.4567')          // → '5551234567'
 * cleanPhoneNumber('+15551234567')            // → '5551234567'
 * 
 * @example
 * // Invalid number handling
 * cleanPhoneNumber('0000000000')              // → null (invalid pattern)
 * cleanPhoneNumber('1234567890')              // → null (invalid area code)
 * cleanPhoneNumber('+353874075705')           // → null (international)
 * cleanPhoneNumber('41362')                   // → null (short code)
 * 
 * @example
 * // Statistics collection
 * const stats = createProcessingStats();
 * cleanPhoneNumber('911', stats);
 * cleanPhoneNumber('5551234567', stats);
 * cleanPhoneNumber('123', stats);
 * 
 * console.log(stats.serviceNumbers);          // 1
 * console.log(stats.tenDigitNumbers);         // 1
 * console.log(stats.invalidNumbers);          // 1
 * console.log(stats.serviceNumberBreakdown['911']); // 1
 * 
 * @example
 * // Edge cases
 * cleanPhoneNumber(null)                      // → null
 * cleanPhoneNumber('')                        // → null
 * cleanPhoneNumber('abc')                     // → null
 * cleanPhoneNumber('0911')                    // → null (4 digits, not service)
 * cleanPhoneNumber('1911')                    // → null (4 digits, not service)
 * cleanPhoneNumber('91')                      // → null (incomplete)
 * cleanPhoneNumber('9111')                    // → null (too long for service)
 * 
 * @throws {TypeError} Does not throw - returns null for invalid inputs
 * 
 * @since 2.1.0
 * @see {@link isValidServiceNumber} for service number validation logic
 * @see {@link createProcessingStats} for statistics object creation
 * @see {@link VALID_SERVICE_NUMBERS} for complete list of supported service numbers
 */
function cleanPhoneNumber(phone, stats = null) {
  // === INPUT VALIDATION PHASE ===
  // Reject null, undefined, or non-string inputs immediately
  if (!phone || typeof phone !== 'string') return null;

  // === CHARACTER NORMALIZATION PHASE ===
  // Strip all non-numeric characters to get clean digits only
  // This handles formats like: +1-555-123-4567, (555) 123-4567, 9-1-1, etc.
  let cleaned = phone.replace(/\D/g, '');

  // Reject empty results (input was all non-numeric characters)
  if (!cleaned || cleaned.length === 0) return null;

  // === 3-DIGIT SERVICE NUMBER PROCESSING ===
  // Critical path for emergency and service numbers (911, 411, etc.)
  if (cleaned.length === 3) {
    // Check against whitelist of valid North American service numbers
    if (isValidServiceNumber(cleaned)) {
      // === VALID SERVICE NUMBER FOUND ===
      // Map service number to human-readable description for logging
      let serviceDescription = '';
      switch(cleaned) {
        case '911': serviceDescription = 'Emergency services'; break;        // CRITICAL
        case '411': serviceDescription = 'Directory assistance'; break;      // BILLABLE
        case '511': serviceDescription = 'Traffic information'; break;       // PUBLIC SERVICE
        case '611': serviceDescription = 'Repair service'; break;            // CUSTOMER SUPPORT
        case '711': serviceDescription = 'Telecommunications relay'; break;  // ACCESSIBILITY
        case '811': serviceDescription = 'Utility location'; break;          // SAFETY
      }
      
      // === DEBUG LOGGING FOR SERVICE NUMBER DETECTION ===
      // Only log when debug mode is enabled to avoid log spam in production
      if (process.env.LOG_LEVEL === 'debug' || process.env.LOG_SERVICE_NUMBER_DETAILS === 'true') {
        console.log(`🚨 Service number detected: '${phone}' -> '${cleaned}' (${serviceDescription})`);
      }
      
      // === STATISTICS COLLECTION FOR VALID SERVICE NUMBERS ===
      if (stats) {
        stats.serviceNumbers++;                           // Increment total service number count
        stats.serviceNumberBreakdown[cleaned]++;          // Increment specific service number count
        stats.totalProcessed++;                           // Increment overall processing count
        stats.uniqueNumbers.add(cleaned);                 // Track unique numbers (Set handles duplicates)
      }
      
      // Return the cleaned 3-digit service number (preserved in original format)
      return cleaned;
      
    } else {
      // === INVALID 3-DIGIT NUMBER HANDLING ===
      // Provide detailed logging to help troubleshoot data quality issues
      console.warn(`⚠️  Invalid 3-digit service number rejected: '${phone}' -> '${cleaned}'`);
      console.warn(`   Valid service numbers are: ${VALID_SERVICE_NUMBERS.join(', ')}`);
      
      // === CONTEXTUAL HELP FOR COMMON INVALID PATTERNS ===
      // Provide specific guidance based on the invalid number pattern
      if (['123', '999', '000', '555'].includes(cleaned)) {
        console.warn(`   Note: '${cleaned}' is a common test/placeholder number, not a valid service code`);
      } else if (cleaned.startsWith('1') || cleaned.startsWith('0')) {
        console.warn(`   Note: Service numbers cannot start with '${cleaned.charAt(0)}'`);
      } else {
        console.warn(`   Note: '${cleaned}' is not recognized as a North American service number`);
      }
      
      // === STATISTICS COLLECTION FOR INVALID 3-DIGIT NUMBERS ===
      if (stats) {
        stats.invalidNumbers++;                           // Increment invalid number count
        stats.totalProcessed++;                           // Increment overall processing count
        stats.invalidCategories.shortCodes++;             // Categorize as invalid short code
        // Collect sample invalid numbers for troubleshooting (limit to 10 to prevent memory issues)
        if (stats.invalidExamples.length < 10) {
          stats.invalidExamples.push(`Invalid 3-digit: ${phone}`);
        }
      }
      
      // Return null to indicate invalid number
      return null;
    }
  }

  // Remove leading 1 if we have 11 digits (North American format)
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    cleaned = cleaned.substring(1);
  }

  // Handle 10-digit numbers (existing logic preserved)
  if (cleaned.length === 10) {
    // Validate it's a reasonable phone number (not all zeros, etc.)
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

    // First digit should be 2-9 for valid North American numbers
    if (cleaned.charAt(0) >= '2' && cleaned.charAt(0) <= '9') {
      // Update statistics if provided
      if (stats) {
        stats.tenDigitNumbers++;
        stats.totalProcessed++;
        stats.uniqueNumbers.add(cleaned);
      }
      return cleaned;
    } else {
      // Invalid area code
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

  // Log problematic numbers for debugging (but don't fail processing)
  if (cleaned.length !== 10 && cleaned.length !== 3) {
    console.warn(`Invalid phone number length (${cleaned.length} digits): ${phone} -> ${cleaned}`);
  }

  // Invalid length - track in stats with categorization
  if (stats) {
    stats.invalidNumbers++;
    stats.totalProcessed++;

    // Categorize the invalid number
    if (cleaned.length > 10) {
      // Likely international number
      stats.invalidCategories.international++;
    } else if (cleaned.length >= 4 && cleaned.length <= 6) {
      // Short codes
      stats.invalidCategories.shortCodes++;
    } else {
      // Other invalid lengths
      stats.invalidCategories.invalidLength++;
    }

    if (stats.invalidExamples.length < 10) {
      stats.invalidExamples.push(`Invalid length (${cleaned.length}): ${phone}`);
    }
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