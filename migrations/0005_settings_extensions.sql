-- Phase 7: Extended VM settings for RDP checks and safe maintenance mode

-- Add new columns to vm_settings table
ALTER TABLE vm_settings ADD COLUMN rdp_check_enabled INTEGER NOT NULL DEFAULT 1 CHECK (rdp_check_enabled IN (0, 1));
ALTER TABLE vm_settings ADD COLUMN rdp_check_interval_minutes INTEGER NOT NULL DEFAULT 5 CHECK (rdp_check_interval_minutes >= 1 AND rdp_check_interval_minutes <= 60);
ALTER TABLE vm_settings ADD COLUMN safe_maintenance_mode INTEGER NOT NULL DEFAULT 0 CHECK (safe_maintenance_mode IN (0, 1));