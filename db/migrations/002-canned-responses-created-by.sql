-- meta-bridge schema · migration 002-canned-responses-created-by
-- Adds created_by to canned_responses for user-level ownership/filtering.
-- Since this is a single-tenant bridge (one bridge = one CRM org), filtering
-- by created_by (SuiteCRM user ID) is the appropriate access scope guard.
-- Applied: 2026-05-11

ALTER TABLE `meta_bridge`.`canned_responses`
  ADD COLUMN `created_by` VARCHAR(100) NULL DEFAULT NULL AFTER `shortcut`;
