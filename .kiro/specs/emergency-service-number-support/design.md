# Design Document

## Overview

This design enhances the existing phone number cleaning logic in the VoIP Innovations CDR processing system to properly handle 3-digit emergency and service numbers (911, 411, 511, 611, 711, 811) while maintaining existing validation for 10-digit phone numbers.

The solution modifies the `cleanPhoneNumber` function in `VI_GetCDRs.js` to recognize and preserve valid 3-digit service numbers, updates logging to provide better visibility into phone number processing, and ensures database compatibility.

## Architecture

### Current Architecture
```
CDR CSV → Parse → cleanPhoneNumber() → Filter Invalid → Database
                      ↓
                 Only 10-digit numbers pass
                 3-digit numbers filtered out
```

### Enhanced Architecture
```
CDR CSV → Parse → enhancedCleanPhoneNumber() → Filter Invalid → Database
                           ↓
                  10-digit numbers + 3-digit service numbers pass
                  Invalid numbers filtered out with better logging
```

## Components and Interfaces

### 1. Enhanced Phone Number Cleaning Function

**Function Signature:**
```javascript
function cleanPhoneNumber(phone)
```

**Input:** String representing a phone number (any format)
**Output:** String (cleaned number) or null (invalid)

**Logic Flow:**
1. **Input Validation**: Check for null/empty/non-string inputs
2. **Character Cleaning**: Remove all non-numeric characters
3. **Length-Based Processing**:
   - 3 digits: Validate against service number whitelist
   - 11 digits starting with '1': Remove leading 1, validate as 10-digit
   - 10 digits: Apply existing validation logic
   - Other lengths: Return null (invalid)

### 2. Service Number Validation

**Valid 3-Digit Service Numbers:**
- `911` - Emergency services
- `411` - Directory assistance
- `511` - Traffic information
- `611` - Repair service
- `711` - Telecommunications relay service
- `811` - Utility location service

**Implementation:**
```javascript
const VALID_SERVICE_NUMBERS = ['911', '411', '511', '611', '711', '811'];

function isValidServiceNumber(number) {
  return VALID_SERVICE_NUMBERS.includes(number);
}
```

### 3. Enhanced Logging and Metrics

**New Logging Categories:**
- Service numbers processed (count by type)
- Invalid 3-digit numbers encountered
- Separate tracking for 10-digit vs 3-digit processing

**Metrics Tracking:**
```javascript
const processingStats = {
  tenDigitNumbers: 0,
  serviceNumbers: 0,
  invalidNumbers: 0,
  serviceNumberBreakdown: {
    '911': 0, '411': 0, '511': 0, 
    '611': 0, '711': 0, '811': 0
  }
};
```

## Data Models

### Phone Number Processing Result
```javascript
{
  cleanedNumber: string | null,  // Cleaned phone number or null if invalid
  numberType: 'ten-digit' | 'service' | 'invalid',
  originalInput: string,         // Original input for debugging
  processingNote: string         // Reason for validation result
}
```

### Processing Statistics
```javascript
{
  totalProcessed: number,
  tenDigitNumbers: number,
  serviceNumbers: number,
  invalidNumbers: number,
  serviceNumberBreakdown: {
    '911': number,
    '411': number,
    '511': number,
    '611': number,
    '711': number,
    '811': number
  },
  invalidExamples: string[]      // Sample invalid numbers for debugging
}
```

## Error Handling

### 1. Invalid Service Numbers
- **Scenario**: 3-digit number not in service number whitelist (e.g., "123", "999")
- **Handling**: Log warning, return null, include in invalid number count
- **Logging**: `console.warn('Invalid 3-digit number: ${number}')`

### 2. Malformed Input
- **Scenario**: Non-string input, empty strings, only special characters
- **Handling**: Return null immediately, minimal logging to avoid spam
- **Logging**: Debug level only for performance

### 3. Edge Cases
- **Leading zeros**: "0911" → should be treated as invalid, not as "911"
- **Padded service numbers**: "911 " → should clean to "911"
- **Mixed format**: "9-1-1" → should clean to "911"

### 4. Alert Threshold Adjustment
- **Current**: Alerts when invalid numbers exceed 10% or minimum 5
- **Enhanced**: Exclude valid service numbers from invalid count
- **New Logic**: `invalidCount = totalInvalid - validServiceNumbers`

## Testing Strategy

### 1. Unit Tests for Phone Number Cleaning

**Test Cases:**
```javascript
// Emergency numbers
cleanPhoneNumber('911') → '911'
cleanPhoneNumber('9-1-1') → '911'
cleanPhoneNumber(' 911 ') → '911'

// Directory assistance
cleanPhoneNumber('411') → '411'
cleanPhoneNumber('4.1.1') → '411'

// Other service numbers
cleanPhoneNumber('511') → '511'
cleanPhoneNumber('611') → '611'
cleanPhoneNumber('711') → '711'
cleanPhoneNumber('811') → '811'

// Invalid 3-digit numbers
cleanPhoneNumber('123') → null
cleanPhoneNumber('999') → null
cleanPhoneNumber('000') → null

// Existing 10-digit validation (regression tests)
cleanPhoneNumber('5551234567') → '5551234567'
cleanPhoneNumber('+1-555-123-4567') → '5551234567'
cleanPhoneNumber('0000000000') → null

// Edge cases
cleanPhoneNumber('0911') → null (not emergency, invalid 4-digit)
cleanPhoneNumber('1911') → null (not emergency, invalid 4-digit)
cleanPhoneNumber('91') → null (incomplete)
cleanPhoneNumber('9111') → null (too long for service, too short for regular)
```

### 2. Integration Tests

**Test Scenarios:**
1. **Mixed CDR File**: File containing 10-digit numbers, service numbers, and invalid numbers
2. **Service Number Heavy**: File with high percentage of 911/411 calls
3. **Alert Threshold**: Verify alerts don't trigger for valid service numbers
4. **Database Storage**: Confirm 3-digit numbers store and retrieve correctly

### 3. Performance Tests

**Benchmarks:**
- Processing speed with mixed number types
- Memory usage with large datasets containing service numbers
- Database insertion performance with 3-digit numbers

### 4. Regression Tests

**Validation:**
- Existing 10-digit number processing unchanged
- Alert thresholds work correctly
- Database schema compatibility
- Backup file format consistency

## Database Considerations

### Schema Compatibility
- **Current Fields**: `source` and `destination` are `nvarchar(20)`
- **3-Digit Numbers**: Fit well within existing field sizes
- **No Schema Changes**: Required - maintains backward compatibility

### Query Implications
- **Reporting Queries**: May need updates to distinguish service vs regular numbers
- **Length-Based Filtering**: Existing queries using `LEN()` may need review
- **Indexing**: Current indexes on phone number fields remain effective

### Data Migration
- **No Migration Needed**: Change is forward-compatible only
- **Historical Data**: Remains unchanged (3-digit numbers were previously filtered)
- **Backup Compatibility**: JSON backup format unchanged

## Performance Impact

### Processing Speed
- **Minimal Impact**: Additional validation adds ~1-2% processing time
- **Service Number Check**: O(1) lookup in small array (6 elements)
- **Memory Usage**: Negligible increase for statistics tracking

### Database Performance
- **Insert Performance**: No change (same field types and sizes)
- **Query Performance**: No impact on existing queries
- **Storage**: Slightly reduced storage (3 chars vs 10 chars for service numbers)

## Security Considerations

### Input Validation
- **Sanitization**: Maintains existing character stripping for security
- **Injection Prevention**: No new SQL injection vectors introduced
- **Data Integrity**: Enhanced validation improves data quality

### Logging Security
- **PII Handling**: Phone numbers in logs (existing behavior maintained)
- **Log Rotation**: No additional sensitive data in logs
- **Access Control**: Existing log access controls sufficient

## Monitoring and Observability

### New Metrics
1. **Service Number Counts**: Track volume of each service number type
2. **Processing Statistics**: Ratio of service to regular numbers
3. **Invalid Number Patterns**: Better categorization of invalid inputs

### Enhanced Alerts
- **Service Number Anomalies**: Unusual spikes in emergency calls
- **Processing Quality**: Improved invalid number reporting
- **Data Quality**: Better visibility into phone number processing issues

### Dashboard Considerations
- **CDR Processing Dashboard**: Add service number metrics
- **Quality Monitoring**: Enhanced phone number validation reporting
- **Operational Alerts**: Service number volume monitoring for capacity planning

## Documentation Updates

### README.md Updates

**Phone Number Cleaning Section Enhancement:**
- Update examples to include 3-digit service numbers
- Document the complete list of supported service numbers
- Add troubleshooting section for service number processing
- Update data validation section to reflect new logic

**New Documentation Sections:**
```markdown
### Service Number Support
The system now supports 3-digit emergency and service numbers:
- **911** - Emergency services
- **411** - Directory assistance  
- **511** - Traffic information
- **611** - Repair service
- **711** - Telecommunications relay service
- **811** - Utility location service

**Input Examples** → **Output**
- `911` → `911`
- `9-1-1` → `911`
- `411` → `411`
- `4.1.1` → `411`
- `123` → `null` (invalid 3-digit)
```

**Updated Phone Number Cleaning Examples:**
```markdown
### Phone Number Cleaning
The system normalizes phone numbers and preserves valid service numbers:

**10-Digit Numbers:**
- `+1-555-123-4567` → `5551234567`
- `(555) 123-4567` → `5551234567`
- `1.555.123.4567` → `5551234567`
- `+15551234567` → `5551234567`
- `0000000000` → `null` (invalid)

**3-Digit Service Numbers:**
- `911` → `911`
- `411` → `411`
- `511` → `511`
- `611` → `611`
- `711` → `711`
- `811` → `811`
- `123` → `null` (invalid service number)
```

### Code Comments and Documentation

**Function Documentation:**
```javascript
/**
 * Cleans and validates phone numbers, supporting both 10-digit regular numbers
 * and 3-digit emergency/service numbers.
 * 
 * Supported 3-digit service numbers: 911, 411, 511, 611, 711, 811
 * 
 * @param {string} phone - Raw phone number in any format
 * @returns {string|null} - Cleaned phone number or null if invalid
 * 
 * Examples:
 *   cleanPhoneNumber('911') → '911'
 *   cleanPhoneNumber('555-123-4567') → '5551234567'
 *   cleanPhoneNumber('123') → null (invalid service number)
 */
```

**Processing Statistics Documentation:**
```javascript
/**
 * Phone number processing statistics for monitoring and debugging
 * 
 * @typedef {Object} ProcessingStats
 * @property {number} totalProcessed - Total numbers processed
 * @property {number} tenDigitNumbers - Count of valid 10-digit numbers
 * @property {number} serviceNumbers - Count of valid 3-digit service numbers
 * @property {number} invalidNumbers - Count of invalid numbers
 * @property {Object} serviceNumberBreakdown - Count by service number type
 * @property {string[]} invalidExamples - Sample invalid numbers for debugging
 */
```

### Troubleshooting Documentation

**New Troubleshooting Section:**
```markdown
#### Service Number Processing Issues

**Missing Emergency Calls (911)**
- Verify 911 calls appear in console logs as "service numbers processed"
- Check database for records with destination = '911'
- Review invalid phone number alerts to ensure 911 isn't being filtered

**Directory Assistance Billing (411)**
- Confirm 411 calls are being stored with correct CallType
- Verify billing rates are applied to 3-digit service numbers
- Check CDR reports include service number calls

**Invalid Service Number Alerts**
- Review console warnings for unrecognized 3-digit numbers
- Common false positives: area codes starting with service numbers (e.g., "911" in "9115551234")
- Validate input data format from VoIP Innovations
```

### Configuration Documentation

**Environment Variable Updates:**
```markdown
#### Logging Configuration
```env
# Enhanced logging for phone number processing
LOG_PHONE_NUMBER_STATS=true
LOG_SERVICE_NUMBER_DETAILS=true
```

**Alert Configuration Updates:**
```markdown
#### Alert Thresholds
- **Phone Number Quality**: Alerts when invalid numbers exceed 10% of records or minimum of 5
- **Service Numbers**: Valid 3-digit service numbers are excluded from invalid count
- **Emergency Call Volume**: Optional alerts for unusual 911 call volume spikes
```