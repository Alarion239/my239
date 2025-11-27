-- Create migrations tracking table
CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY
);

-- Initialize with version 0 if table is empty
INSERT INTO migrations (version) 
SELECT 0 
WHERE NOT EXISTS (SELECT 1 FROM migrations);

