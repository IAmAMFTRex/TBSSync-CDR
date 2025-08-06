/**
 * Process existing CDR files with enhanced service number support
 * Processes all CDR files in the ./cdrs directory
 * 
 * Usage: node process_existing_cdrs.js
 */

require('dotenv').config();
const fs = require('fs');
const Papa = require('papaparse');
const sql = require('mssql');

// Enhanced phone number processing (from the main application)
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

function processAndCleanCDRs(parsedCDRs) {
  const processingStats = createProcessingStats();
  let invalidPhoneNumbers = [];
  
  const processedRecords = parsedCDRs.map(record => {
    try {
      // Timezone conversion (PST offset)
      let startTime = null;
      if (record.StartTime) {
        startTime = new Date(record.StartTime);
        const isDST = startTime.getTimezoneOffset() < new Date(startTime.getFullYear(), 0, 1).getTimezoneOffset();
        const pstOffset = isDST ? -7 : -8;
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
    console.log(`\n🚨 Service Numbers Found:`);
    Object.entries(processingStats.serviceNumberBreakdown).forEach(([number, count]) => {
      if (count > 0) {
        let description = '';
        switch(number) {
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

  return { processedRecords, processingStats, invalidPhoneNumbers };
}

// Database configuration
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

// Write to SQL database
async function writeToDatabase(processedData, filename) {
  try {
    console.log(`💾 Writing ${processedData.length} records to SQL for file: ${filename}`);

    const pool = await sql.connect(dbconfig);
    const request = pool.request();

    request.input('cdrData', sql.NVarChar(sql.MAX), JSON.stringify(processedData));
    request.input('filename', sql.NVarChar(255), filename);
    request.output('recordCount', sql.Int);

    const result = await request.execute('VI_StoreCDRs');

    console.log(`✅ Successfully inserted ${result.output.recordCount} records from ${filename} into database`);

  } catch (error) {
    console.error(`❌ Database error for ${filename}:`, error.message);
    throw error;
  } finally {
    await sql.close();
  }
}

async function processExistingCDRs() {
  console.log('🚀 Processing existing CDR files with enhanced service number support...\n');
  
  // Safety confirmation
  console.log('⚠️  WARNING: This script will write processed CDR data to your SQL database.');
  console.log('   Make sure your database connection is properly configured in .env file.');
  console.log('   The VI_StoreCDRs stored procedure will be used to insert data.');
  console.log('   Duplicate records will be automatically handled by the stored procedure.\n');
  
  const cdrDirectory = './cdrs';
  
  if (!fs.existsSync(cdrDirectory)) {
    console.error('❌ CDR directory not found. Please ensure ./cdrs directory exists.');
    return;
  }
  
  const files = fs.readdirSync(cdrDirectory).filter(file => file.endsWith('.CDR'));
  
  if (files.length === 0) {
    console.log('⚠️  No CDR files found in ./cdrs directory');
    return;
  }
  
  console.log(`📁 Found ${files.length} CDR files to process:`);
  files.forEach(file => console.log(`  - ${file}`));
  
  let totalServiceNumbers = 0;
  let totalProcessedRecords = 0;
  let totalFiles = 0;
  
  // Create backup directory if it doesn't exist
  if (!fs.existsSync('./bak')) {
    fs.mkdirSync('./bak', { recursive: true });
  }
  
  for (const file of files) {
    try {
      console.log(`\n=== Processing ${file} ===`);
      
      const filePath = `${cdrDirectory}/${file}`;
      const cdrContent = fs.readFileSync(filePath, 'utf8');
      
      const config = {
        delimiter: ';',
        header: true,
        skipEmptyLines: true,
      };
      
      const parseResult = Papa.parse(cdrContent, config);
      const parsedCDRs = parseResult.data;
      
      console.log(`📊 Parsed ${parsedCDRs.length} CDR records`);
      
      // Process with enhanced service number support
      const { processedRecords, processingStats, invalidPhoneNumbers } = processAndCleanCDRs(parsedCDRs);
      
      console.log(`✅ Successfully processed ${processedRecords.length} records`);
      
      // Save backup
      const backupFile = `./bak/processed_${file.replace('.CDR', '.json')}`;
      fs.writeFileSync(backupFile, JSON.stringify(processedRecords, null, 2));
      console.log(`💾 Backup saved: ${backupFile}`);
      
      // Accumulate totals
      totalServiceNumbers += processingStats.serviceNumbers;
      totalProcessedRecords += processedRecords.length;
      totalFiles++;
      
      // Write to database
      try {
        await writeToDatabase(processedRecords, file);
        console.log(`✅ Database insertion completed for ${file}`);
      } catch (dbError) {
        console.error(`❌ Database insertion failed for ${file}:`, dbError.message);
        console.log(`💾 Data is still available in backup file: ./bak/processed_${file.replace('.CDR', '.json')}`);
      }
      
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error.message);
    }
  }
  
  console.log('\n🎉 Processing Complete!');
  console.log(`📊 Summary:`);
  console.log(`  Files processed: ${totalFiles}`);
  console.log(`  Total records: ${totalProcessedRecords}`);
  console.log(`  Service numbers found: ${totalServiceNumbers}`);
  
  if (totalServiceNumbers > 0) {
    console.log('\n🚨 IMPORTANT: Service numbers were found and preserved!');
    console.log('   This includes emergency calls (911) and directory assistance (411)');
    console.log('   These were previously being filtered out but are now captured.');
  }
  
  console.log('\n📋 Next Steps:');
  console.log('1. Review backup files in ./bak/ directory');
  console.log('2. Uncomment database writing code if you want to store in SQL');
  console.log('3. Consider running the main application going forward to capture service numbers');
}

// Run the processing
processExistingCDRs().catch(console.error);