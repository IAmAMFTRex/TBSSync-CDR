ALTER PROCEDURE [dbo].[VI_StoreCDRs]
    @cdrData NVARCHAR(MAX),
    @filename NVARCHAR(255),
    @recordCount INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    
    BEGIN TRY
        BEGIN TRANSACTION;
        
        -- Clear staging table
        TRUNCATE TABLE VI_Inboundcdrs;
        
        -- Insert pre-processed data (no more file reading or complex parsing)
        INSERT INTO VI_Inboundcdrs
        SELECT * FROM OPENJSON(@cdrData)
        WITH (
            StartTime datetime2 '$.StartTime',
            BillDuration int '$.BillDuration',
            CallPrice decimal(10,4) '$.CallPrice',
            ANI nvarchar(20) '$.ANI',
            DNIS nvarchar(20) '$.DNIS',
            CustomerIP nvarchar(50) '$.CustomerIP',
            CallType nvarchar(50) '$.CallType',
            LRN nvarchar(20) '$.LRN'
        );
        
        -- Get record count
        SET @recordCount = @@ROWCOUNT;
        
        -- Insert into main CDR table with deduplication
        -- No more complex phone number processing - handled in JavaScript
        INSERT INTO cdr ([date], source, destination, seconds, callerid, disposition, cost, peer, SIP, CallType)
        SELECT 
            StartTime,
            ANI,
            DNIS,
            BillDuration,
            ANI,
            'ANSWERED',
            CallPrice,
            CustomerIP,
            'VI',
            CallType
        FROM VI_Inboundcdrs vi
        WHERE NOT EXISTS (
            SELECT 1 FROM cdr c 
            WHERE c.[date] = vi.StartTime 
            AND c.source = vi.ANI 
            AND c.destination = vi.DNIS
            AND c.seconds = vi.BillDuration
            AND c.cost = vi.CallPrice
        );
        
        -- Clean up staging table
        TRUNCATE TABLE VI_Inboundcdrs;
        
        -- Audit log
        INSERT INTO AuditTrail(cid, event, outcome, eventdate, datavalue, category, vendor, direction)
        VALUES (0, 'Processed ' + @filename, 'Success', GETDATE(), 
                CAST(@recordCount AS VARCHAR) + ' CDR records processed', 
                'API Event', 'VoIP Innovations', 'Inbound');
        
        COMMIT TRANSACTION;
        
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        
        -- Log error
        INSERT INTO AuditTrail(cid, event, outcome, eventdate, datavalue, category, vendor, direction)
        VALUES (0, 'CDR Processing Error - ' + @filename, 'Failed', GETDATE(), 
                ERROR_MESSAGE(), 'API Event', 'VoIP Innovations', 'Inbound');
        
        -- Re-throw the error
        THROW;
    END CATCH
END