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
- **Data Processing**: Phone number cleaning, timezone conversion, data validation
- **Database Integration**: Efficient SQL Server storage with deduplication
- **Error Handling**: Comprehensive error catching with transaction rollback
- **Email Alerting**: SMTP notifications for system issues and data quality problems
- **Security**: Environment variable configuration for sensitive credentials
- **Logging**: Detailed console logging and audit trail in database

## Architecture

### Data Flow
```
VoIP Innovations FTP → Download → Parse CSV → Clean Data → SQL Server
                                      ↓
                              Backup JSON Files
                                      ↓
                              Email Alerts (if issues)
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
    source nvarchar(20),      -- Cleaned ANI (10 digits)
    destination nvarchar(20), -- Cleaned DNIS (10 digits)
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

### Manual Execution
```bash
node VI_GetCDRs.js
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
The system normalizes phone numbers to 10-digit format:

**Input Examples** → **Output**
- `+1-555-123-4567` → `5551234567`
- `(555) 123-4567` → `5551234567`
- `1.555.123.4567` → `5551234567`
- `+15551234567` → `5551234567`
- `0000000000` → `null` (invalid)

### Timezone Conversion
- Converts UTC timestamps to PST/PDT automatically
- Handles daylight saving time transitions
- Uses dynamic offset calculation

### Data Validation
- Removes records with invalid phone numbers
- Validates numeric fields (duration, cost)
- Filters out duplicate records

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
├── VI_GetCDRs.js          # Main application
├── VI_StoreCDRs.sql       # SQL stored procedure
├── test-alert.js          # SMTP testing utility
├── .env                   # Environment configuration
├── .env.example           # Environment template
├── README.md              # This file
├── cdrs/                  # Downloaded CDR files (temporary)
├── bak/                   # Processed JSON backups
└── logs/                  # Application logs (optional)
```

## Monitoring & Maintenance

### Daily Monitoring
- Check email alerts for any processing issues
- Verify CDR record counts in database
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

### v2.0.0 (Current)
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