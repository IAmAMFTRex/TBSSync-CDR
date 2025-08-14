# VoIP Innovations CDR Processing System


A Node.js application that downloads, processes, and stores Call Detail Records (CDRs) from VoIP Innovations into a Microsoft SQL Server database for billing purposes.

## Overview

This system automates the daily processing of telecom billing data by:
1. Connecting to VoIP Innovations FTP server
2. Downloading CDR files in CSV format
3. Processing and cleaning the data (phone number normalization, timezone conversion)
4. Storing processed data in SQL Server via stored procedure
5. Providing comprehensive error handling and email alerting

## Features

- **Automated FTP Download**: Secure connection to VoIP Innovations CDR server
- **Optimized FTP Connections**: Direct connection to proven working method (eliminates failed connection attempts)
- **Data Processing**: Phone number cleaning, timezone conversion, data validation
- **Service Number Support**: Preserves 3-digit emergency and service numbers
- **Database Integration**: Efficient SQL Server storage with deduplication
- **Error Handling**: Comprehensive error catching with transaction rollback
- **Email Alerting**: SMTP notifications for system issues and data quality problems
- **Security**: Environment variable configuration for sensitive credentials
- **Enhanced Logging**: Detailed console logging with service number tracking

## Service Number Support

The system now supports 3-digit emergency and service numbers, ensuring critical calls are properly captured and stored:

### Supported Service Numbers
- **911** - Emergency services (CRITICAL - Must be captured for compliance)
- **411** - Directory assistance (BILLABLE - Revenue impact)
- **511** - Traffic information (INFO - Public service)
- **611** - Repair service (SUPPORT - Customer service)
- **711** - Telecommunications relay (ACCESSIBILITY - ADA compliance)
- **811** - Utility location (SAFETY - Infrastructure protection)

### Key Benefits
- **Compliance**: Emergency calls (911) are preserved for regulatory requirements
- **Billing Accuracy**: Directory assistance calls (411) are captured for revenue tracking
- **Complete Records**: All service-related calls are maintained in the database
- **Data Quality**: Service numbers are excluded from invalid phone number alerts
- **Operational Visibility**: Enhanced logging provides detailed service number statistics

### Processing Logic
1. **Recognition**: System identifies valid 3-digit service numbers
2. **Preservation**: Service numbers are stored in their original 3-digit format
3. **Validation**: Invalid 3-digit numbers (like 123, 999) are rejected
4. **Statistics**: Detailed tracking and reporting of service number usage
5. **Alerting**: Service numbers don't trigger false positive data quality alerts

## Retroactive Processing

The system includes powerful retroactive processing capabilities to recover historical CDR data with enhanced service number support. This is particularly important for recovering previously filtered emergency calls (911) and directory assistance calls (411).

### Available Scripts

#### 1. VI_GetCDRs_Retroactive.js - Historical FTP Download
Downloads and processes CDRs for specific dates or date ranges directly from VoIP Innovations FTP server.

Y
**Usage:**
```bash
# Process single date
node VI_GetCDRs_Retroactive.js 2025-01-13

# Process date range
node VI_GetCDRs_Retroactive.js 2025-01-13 2025-01-15
```

**Features:**
- Downloads CDRs from VoIP Innovations FTP for any historical date
- Processes with full service number support (911, 411, etc.)
- Creates backup JSON files for all processed data
- Automatic database insertion via VI_StoreCDRs stored procedure
- Comprehensive error handling and recovery
- Detailed processing statistics and logging

#### 2. process_existing_cdrs.js - Local File Processing
Processes existing CDR files in the ./cdrs directory with enhanced service number support.

**Usage:**
```bash
node process_existing_cdrs.js
```

**Features:**
- Processes all .CDR files in the ./cdrs directory
- Applies enhanced service number processing to historical data
- Creates backup files for all processed data
- Database integration with deduplication support
- Detailed service number statistics and reporting

### Retroactive Processing Benefits

#### Data Recovery
- **Emergency Calls**: Recovers previously filtered 911 emergency calls
- **Directory Assistance**: Captures 411 calls that were lost to filtering
- **Service Numbers**: Preserves all valid 3-digit service numbers (511, 611, 711, 811)
- **Historical Completeness**: Fills gaps in historical CDR data

#### Compliance & Billing
- **Regulatory Compliance**: Ensures emergency call records are maintained
- **Revenue Recovery**: Captures billable directory assistance calls
- **Audit Trail**: Complete historical record for compliance audits
- **Data Integrity**: Maintains consistent data format across all periods

#### Processing Features
- **Enhanced Statistics**: Detailed breakdown of service numbers found
- **Backup Creation**: JSON backups of all processed data
- **Database Integration**: Seamless insertion with existing schema
- **Deduplication**: Automatic handling of duplicate records
- **Error Recovery**: Robust error handling with data preservation

### Retroactive Processing Workflow

```
Historical Date Range → FTP Download → Parse & Clean → Database Insert
                                           ↓
                                   Backup JSON Files
                                           ↓
                               Service Number Statistics
                                           ↓
                                   Processing Summary
```

### Example Output

```bash
$ node VI_GetCDRs_Retroactive.js 2025-01-13

🚀 Starting retroactive CDR processing...
📅 Date range: Mon Jan 13 2025 to Mon Jan 13 2025

=== Processing Mon Jan 13 2025 (folder: 20250113) ===
Connecting to FTP folder: /20250113/
✅ Downloaded CDRs for Mon Jan 13 2025
Found 3 files in ./cdrs/20250113
Processing file: VI_20250113_001.CDR

=== Phone Number Processing Statistics ===
Total phone numbers processed: 2000
10-digit numbers: 1985
Service numbers: 12
Invalid numbers: 3

🚨 Service Numbers Found:
  911 (Emergency services): 8 calls
  411 (Directory assistance): 4 calls

✅ Backup saved: ./bak/20250113_VI_20250113_001.CDR
✅ Database insertion completed for VI_20250113_001.CDR

🎉 Retroactive processing complete!
✅ Successfully processed: 1 dates
❌ Errors encountered: 0 dates
```

### Safety Features

#### Data Protection
- **Backup Files**: All processed data saved as JSON before database insertion
- **Transaction Safety**: Database operations use stored procedure with rollback
- **Original Preservation**: Source files backed up before processing
- **Error Recovery**: Failed operations don't lose processed data

#### Validation
- **Date Range Validation**: Prevents invalid date ranges
- **File Existence Checks**: Verifies files exist before processing
- **Database Connection**: Tests connection before bulk operations
- **Service Number Validation**: Ensures only valid service numbers are preserved

### Configuration Requirements

The retroactive scripts use the same .env configuration as the main application:

```env
# Database Configuration (Required)
DB_USER=your_db_username
DB_PASSWORD=your_db_password
DB_SERVER=localhost
DB_DATABASE=compass

# FTP Configuration (Required for VI_GetCDRs_Retroactive.js)
FTP_HOST=customercdr.voipinnovations.com
FTP_USER=your_ftp_username
FTP_PASSWORD=your_ftp_password
FTP_SECURE=true
```

### Best Practices

#### Before Running Retroactive Processing
1. **Backup Database**: Create database backup before bulk historical processing
2. **Test Configuration**: Verify .env settings with a single date first
3. **Check Disk Space**: Ensure adequate space for backup files
4. **Review Date Range**: Confirm date ranges are correct (YYYY-MM-DD format)

#### During Processing
1. **Monitor Output**: Watch for service number statistics
2. **Check Errors**: Address any FTP or database connection issues
3. **Verify Backups**: Ensure backup files are being created
4. **Track Progress**: Note successful vs failed date processing

#### After Processing
1. **Review Statistics**: Analyze service number recovery results
2. **Validate Database**: Confirm records were inserted correctly
3. **Archive Backups**: Move backup files to long-term storage
4. **Update Documentation**: Record what historical periods were processed

### Troubleshooting Retroactive Processing

#### Common Issues

**FTP Connection Failures**
```bash
❌ Failed to download CDRs for Mon Jan 13 2025: Connection timeout
```
- Check FTP credentials in .env file
- Verify date folder exists on FTP server (format: YYYYMMDD)
- Test network connectivity to VoIP Innovations

**Database Connection Issues**
```bash
❌ Database error for VI_20250113_001.CDR: Login failed
```
- Validate SQL Server credentials
- Check database server accessibility
- Verify VI_StoreCDRs stored procedure exists

**No Files Found**
```bash
⚠️  No CDR files found for Mon Jan 13 2025
```
- Verify date format (YYYY-MM-DD)
- Check if CDRs exist for that date on FTP server
- Confirm date is not in the future or too far in the past

**Service Number Processing**
```bash
🚨 Service Numbers Found:
  911 (Emergency services): 15 calls
  411 (Directory assistance): 8 calls
```
- This is expected output showing recovered service numbers
- Review backup files to see the actual service number records
- Verify these numbers appear correctly in the database

### Recovery Scenarios

#### Emergency Call Recovery
If you discover that emergency calls (911) were being filtered out:
```bash
# Process last 30 days to recover recent emergency calls
node VI_GetCDRs_Retroactive.js 2024-12-15 2025-01-13
```

#### Directory Assistance Recovery
For recovering billable directory assistance calls:
```bash
# Process specific billing period
node VI_GetCDRs_Retroactive.js 2024-12-01 2024-12-31
```

#### Complete Historical Recovery
For comprehensive historical data recovery:
```bash
# Process entire year (be careful with large date ranges)
node VI_GetCDRs_Retroactive.js 2024-01-01 2024-12-31
```

## Architecture

### Data Flow
```
VoIP Innovations FTP → Download → Parse CSV → Clean Data → SQL Server
                                      ↓
                              Backup JSON Files
                                      ↓
                              Email Alerts (if issues)

Historical Processing Flow:
Date Range → FTP Download → Enhanced Processing → Database Insert
                                    ↓
                            Service Number Recovery
                                    ↓
                            Backup & Statistics
```

### FTP Connection Optimization

The system now includes intelligent FTP connection optimization that eliminates unnecessary connection attempts:

#### Before Optimization (Legacy Mode)
```
❌ Attempt 1: Explicit FTPS (STARTTLS) - Fails: "550 SSL/TLS required"
❌ Attempt 2: Implicit FTPS (port 990) - Fails: "Connection timeout"
✅ Attempt 3: Standard FTPS (port 21) - Succeeds
```

#### After Optimization (Default Mode)
```
✅ Direct connection: Standard FTPS (port 21) - Succeeds immediately
```

#### Benefits
- **Faster Processing**: Eliminates 2-3 failed connection attempts per date
- **Cleaner Logs**: No more warning messages about failed connection methods
- **Improved Reliability**: Direct connection to proven working method
- **Configurable**: Can be disabled for troubleshooting if needed

#### Configuration
```env
# Enable optimized connections (default: true)
FTP_OPTIMIZED_CONNECTION=true

# Disable to use legacy multiple-attempt mode
FTP_OPTIMIZED_CONNECTION=false
```

### Key Components

1. **VI_GetCDRs.js** - Main application file
2. **VI_StoreCDRs.sql** - SQL Server stored procedure
3. **.env** - Environment configuration
4. **test-alert.js** - SMTP testing utility

## Installation

### Prerequisites
- Node.js (v14 or higher)
- Microsoft SQL Server
- Access to VoIP Innovations FTP server

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd TBSSync
   ```

2. **Install dependencies**
   ```bash
   npm install basic-ftp papaparse mssql nodemailer dotenv
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your actual credentials
   ```

4. **Create required directories**
   ```bash
   mkdir -p cdrs bak
   ```

5. **Deploy stored procedure**
   ```sql
   -- Execute VI_StoreCDRs.sql in your SQL Server database
   ```

## Configuration

### Environment Variables (.env)

#### Database Configuration
```env
DB_USER=your_db_username
DB_PASSWORD=your_db_password
DB_SERVER=localhost
DB_DATABASE=compass
DB_REQUEST_TIMEOUT=300000
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=true
```

#### FTP Configuration
```env
FTP_HOST=customercdr.voipinnovations.com
FTP_USER=your_ftp_username
FTP_PASSWORD=your_ftp_password
FTP_SECURE=true

# FTP Connection Optimization (Optional - Default: true)
# Set to false to enable legacy multiple connection attempts
FTP_OPTIMIZED_CONNECTION=true
```

#### SMTP Alerting
```env
ALERT_EMAIL_FROM=cdr-system@yourcompany.com
ALERT_EMAIL_TO=admin@yourcompany.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_smtp_username
SMTP_PASSWORD=your_smtp_password
SMTP_SECURE=false
```

#### Enhanced Logging Configuration
```env
# Enable debug-level logging for detailed output
LOG_LEVEL=debug

# Enable detailed service number processing logs
LOG_SERVICE_NUMBER_DETAILS=true

# Enable phone number processing statistics
LOG_PHONE_NUMBER_STATS=true
```

### Database Schema

#### Required Tables
- **VI_Inboundcdrs** - Staging table for CDR processing
- **cdr** - Main CDR storage table
- **AuditTrail** - System logging and audit records

#### Main CDR Table Structure
```sql
CREATE TABLE cdr (
    cdrID int IDENTITY(1,1) PRIMARY KEY,
    [date] datetime2,
    source nvarchar(20),      -- Cleaned ANI (10 digits or 3-digit service numbers)
    destination nvarchar(20), -- Cleaned DNIS (10 digits or 3-digit service numbers)
    seconds int,
    callerid nvarchar(20),
    disposition nvarchar(50),
    cost decimal(10,4),
    peer nvarchar(50),
    SIP nvarchar(10),
    CallType nvarchar(50)
);
```

## Usage

### Daily Processing
```bash
# Regular daily processing
node VI_GetCDRs.js
```

### Retroactive Processing
```bash
# Process historical data from FTP server
node VI_GetCDRs_Retroactive.js 2025-01-13
node VI_GetCDRs_Retroactive.js 2025-01-13 2025-01-15

# Process existing local CDR files
node process_existing_cdrs.js
```

### Scheduled Execution
Set up a cron job for daily processing:
```bash
# Run daily at 6:00 AM
0 6 * * * cd /path/to/TBSSync && node VI_GetCDRs.js >> logs/cdr-$(date +\%Y\%m\%d).log 2>&1
```

### Testing SMTP Alerts
```bash
node test-alert.js
```

## Data Processing

### Phone Number Cleaning
The system normalizes phone numbers and preserves valid service numbers:

#### 10-Digit Numbers
**Input Examples** → **Output**
- `+1-555-123-4567` → `5551234567`
- `(555) 123-4567` → `5551234567`
- `1.555.123.4567` → `5551234567`
- `+15551234567` → `5551234567`
- `0000000000` → `null` (invalid)

#### 3-Digit Service Numbers
**Input Examples** → **Output**
- `911` → `911`
- `9-1-1` → `911`
- `411` → `411`
- `4.1.1` → `411`
- `511` → `511`
- `611` → `611`
- `711` → `711`
- `811` → `811`
- `123` → `null` (invalid service number)

### Timezone Conversion
- Converts UTC timestamps to PST/PDT automatically
- Handles daylight saving time transitions
- Uses dynamic offset calculation

### Data Validation
- **Phone Number Processing**: Validates both 10-digit numbers and 3-digit service numbers
- **Service Number Recognition**: Preserves valid emergency and service numbers (911, 411, etc.)
- **Invalid Number Filtering**: Removes records with truly invalid phone numbers
- **Smart Categorization**: Classifies invalid numbers by type (international, short codes, etc.)
- **Numeric Validation**: Validates duration, cost, and other numeric fields
- **Duplicate Prevention**: Filters out duplicate records at database level

## Error Handling & Alerting

### Alert Types
1. **FTP Download Failed** - Connection issues with VoIP Innovations
2. **CDR Processing Warning** - No files found for processing
3. **CDR File Processing Failed** - File reading/parsing errors
4. **CDR Parsing Failed** - CSV parsing issues
5. **CDR Backup Failed** - Backup file creation problems
6. **CDR Processing Failed** - Database operation failures
7. **High Invalid Phone Number Count** - Data quality issues

### Alert Thresholds
- **Phone Number Quality**: Alerts when invalid numbers exceed 10% of records or minimum of 5
- **Service Numbers**: Valid 3-digit service numbers are excluded from invalid count
- **Emergency Call Volume**: Optional alerts for unusual 911 call volume spikes
- **File Processing**: Immediate alerts for any processing failures
- **Database Issues**: Immediate alerts with transaction rollback

### Email Format
```
Subject: CDR System Alert: [Alert Type]

CDR Processing Alert

Subject: [Alert Description]

Details:
[Error message and context]

Timestamp: 2024-01-15T10:30:00.000Z

This is an automated alert from the VoIP Innovations CDR processing system.
```

## File Structure

```
TBSSync/
├── VI_GetCDRs.js              # Main application
├── VI_GetCDRs_Retroactive.js  # Retroactive FTP processing script
├── process_existing_cdrs.js   # Local CDR file processing script
├── VI_StoreCDRs.sql           # SQL stored procedure
├── test-alert.js              # SMTP testing utility
├── .env                       # Environment configuration
├── .env.example               # Environment template
├── README.md                  # This file
├── cdrs/                      # Downloaded CDR files (temporary)
├── bak/                       # Processed JSON backups
└── logs/                      # Application logs (optional)
```

## Enhanced Logging & Statistics

### Processing Statistics
The system now provides comprehensive statistics for phone number processing:

- **Total Numbers Processed**: Count of all phone numbers encountered
- **10-Digit Numbers**: Count and percentage of regular phone numbers
- **Service Numbers**: Count and percentage of 3-digit service numbers
- **Invalid Numbers**: Count and percentage of rejected numbers
- **Service Number Breakdown**: Detailed count by service type (911, 411, etc.)
- **Invalid Number Categorization**: Classification by type (international, short codes, etc.)
- **Processing Performance**: Speed metrics and efficiency reporting

### Enhanced Logging Features
- **Service Number Detection**: Individual logging of each service number found
- **Invalid Number Analysis**: Detailed explanations for rejected numbers
- **Processing Summary**: Comprehensive statistics at completion
- **Debug Mode**: Verbose logging for troubleshooting
- **Performance Metrics**: Processing speed and efficiency tracking

### Log Output Example
```
=== Phone Number Processing Statistics ===
Total CDR records processed: 1000
Total phone numbers processed: 2000
Successfully processed: 1950 (97.5%)

Breakdown by type:
  📞 10-digit numbers: 1940 (97.0%)
  🚨 Service numbers: 10 (0.5%)
  ❌ Invalid numbers: 50 (2.5%)

🚨 Service Number Breakdown:
    911 (Emergency services): 5 calls (50.0% of service numbers)
    411 (Directory assistance): 3 calls (30.0% of service numbers)
    511 (Traffic information): 2 calls (20.0% of service numbers)
```

## Monitoring & Maintenance

### Daily Monitoring
- Check email alerts for any processing issues
- Verify CDR record counts in database
- Monitor service number statistics for unusual patterns
- Review processing efficiency metrics
- Monitor disk space in `bak/` directory

### Log Analysis
```bash
# View recent processing logs
tail -f logs/cdr-$(date +%Y%m%d).log

# Check for errors
grep -i error logs/cdr-*.log
```

### Database Maintenance
```sql
-- Check recent CDR processing
SELECT TOP 10 * FROM AuditTrail 
WHERE category = 'API Event' 
ORDER BY eventdate DESC;

-- Verify CDR counts
SELECT COUNT(*) as total_records, 
       MAX([date]) as latest_record 
FROM cdr WHERE SIP = 'VI';

-- Check service number processing
SELECT 
    destination,
    COUNT(*) as call_count,
    CASE 
        WHEN destination = '911' THEN 'Emergency services'
        WHEN destination = '411' THEN 'Directory assistance'
        WHEN destination = '511' THEN 'Traffic information'
        WHEN destination = '611' THEN 'Repair service'
        WHEN destination = '711' THEN 'Telecommunications relay'
        WHEN destination = '811' THEN 'Utility location'
        ELSE 'Regular number'
    END as service_type
FROM cdr 
WHERE SIP = 'VI' 
    AND LEN(destination) = 3 
    AND destination IN ('911', '411', '511', '611', '711', '811')
GROUP BY destination
ORDER BY call_count DESC;

-- Verify phone number distribution
SELECT 
    CASE 
        WHEN LEN(destination) = 3 THEN '3-digit service'
        WHEN LEN(destination) = 10 THEN '10-digit regular'
        ELSE 'Other'
    END as number_type,
    COUNT(*) as count,
    CAST(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM cdr WHERE SIP = 'VI') AS DECIMAL(5,2)) as percentage
FROM cdr 
WHERE SIP = 'VI'
GROUP BY 
    CASE 
        WHEN LEN(destination) = 3 THEN '3-digit service'
        WHEN LEN(destination) = 10 THEN '10-digit regular'
        ELSE 'Other'
    END
ORDER BY count DESC;
```

## Troubleshooting

### Common Issues

#### FTP Connection Failures
- Verify FTP credentials in `.env`
- Check network connectivity to VoIP Innovations
- Confirm FTP server availability

#### Database Connection Issues
- Validate SQL Server credentials
- Check database server accessibility
- Verify stored procedure exists

#### Email Alert Failures
- Test SMTP configuration with `test-alert.js`
- For Gmail: Use App Passwords, not regular passwords
- Check firewall settings for SMTP ports

#### Phone Number Processing
- Review console warnings for data quality issues
- Check source data format changes
- Validate phone number cleaning logic

#### Service Number Processing Issues

**Missing Emergency Calls (911)**
- Verify 911 calls appear in console logs as "service numbers processed"
- Check database for records with destination = '911'
- Review invalid phone number alerts to ensure 911 isn't being filtered
- Enable debug logging: `LOG_SERVICE_NUMBER_DETAILS=true`

**Directory Assistance Billing (411)**
- Confirm 411 calls are being stored with correct CallType
- Verify billing rates are applied to 3-digit service numbers
- Check CDR reports include service number calls
- Monitor service number breakdown in processing statistics

**Invalid Service Number Alerts**
- Review console warnings for unrecognized 3-digit numbers
- Common false positives: area codes starting with service numbers (e.g., "911" in "9115551234")
- Validate input data format from VoIP Innovations
- Check for formatting issues in source CDR files

**Service Number Statistics**
- Monitor processing logs for service number counts
- Verify service number breakdown percentages
- Check for unusual spikes in emergency call volume
- Review unique service number tracking

**Debug Service Number Processing**
```bash
# Enable detailed service number logging
LOG_SERVICE_NUMBER_DETAILS=true node VI_GetCDRs.js

# Enable debug mode for comprehensive logging
LOG_LEVEL=debug node VI_GetCDRs.js

# Check recent service number processing
grep -i "service number" logs/cdr-*.log
```

### Debug Mode
Enable verbose logging by setting:
```env
LOG_LEVEL=debug
```

## Security Considerations

- **Environment Variables**: All sensitive data stored in `.env`
- **Database Security**: Uses parameterized queries to prevent SQL injection
- **FTP Security**: Secure FTP connection with encryption
- **Email Security**: SMTP authentication with encrypted connections
- **File Permissions**: Ensure `.env` file has restricted permissions (600)

## Performance

### Optimization Features
- **Batch Processing**: Single SQL INSERT for all records
- **Efficient Deduplication**: Database-level duplicate prevention
- **Memory Management**: Streaming file processing for large datasets
- **Transaction Management**: Proper commit/rollback for data integrity

### Typical Performance
- **Processing Speed**: ~1000 records per second
- **File Size**: Handles files up to 100MB efficiently
- **Memory Usage**: ~50MB for typical daily processing

## Contributing

### Development Setup
1. Fork the repository
2. Create feature branch: `git checkout -b feature-name`
3. Make changes and test thoroughly
4. Update documentation as needed
5. Submit pull request

### Testing
```bash
# Test SMTP functionality
node test-alert.js

# Test with sample data
# Place test CSV file in cdrs/ directory and run
node VI_GetCDRs.js
```

## License

[Add your license information here]

## Support

For issues and questions:
- Email: marc@beakrlabs.com
- Create GitHub issue for bugs/features

## Changelog

### v2.1.0 (Current)
- **NEW**: 3-digit service number support (911, 411, 511, 611, 711, 811)
- **NEW**: Retroactive processing capabilities for historical CDR recovery
- **NEW**: VI_GetCDRs_Retroactive.js for FTP-based historical data download
- **NEW**: process_existing_cdrs.js for processing existing local CDR files
- **NEW**: Enhanced phone number processing statistics and logging
- **NEW**: Service number breakdown tracking and reporting
- **NEW**: Comprehensive backup and recovery mechanisms
- **IMPROVED**: Invalid phone number alert logic excludes service numbers
- **IMPROVED**: Comprehensive debug logging for troubleshooting
- **IMPROVED**: Processing performance metrics and efficiency tracking
- **IMPROVED**: Database integration with automatic deduplication
- **FIXED**: Emergency calls (911) and directory assistance (411) now properly preserved
- **FIXED**: Historical data gaps can now be recovered retroactively

### v2.0.0
- Moved data processing from SQL to JavaScript
- Added comprehensive error handling and alerting
- Implemented environment variable configuration
- Enhanced phone number cleaning and validation
- Added SMTP email notifications
- Improved security and performance

### v1.0.0 (Legacy)
- Basic FTP download and SQL processing
- Hardcoded credentials and paths
- Limited error handling