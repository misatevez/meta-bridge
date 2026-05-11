-- meta-bridge · migration 002-notes-audit
-- Target: firmascrm DB on MariaDB @ 129.213.101.91
-- Adds created_by/updated_by ownership columns to conversation_notes
-- and a note_audit_log table for full action history.
-- Idempotent: ALTER uses IF NOT EXISTS, CREATE uses IF NOT EXISTS.

-- Add ownership columns to conversation_notes
ALTER TABLE `conversation_notes`
  ADD COLUMN IF NOT EXISTS `created_by` VARCHAR(255) NULL AFTER `author`,
  ADD COLUMN IF NOT EXISTS `updated_by` VARCHAR(255) NULL AFTER `created_by`,
  ADD COLUMN IF NOT EXISTS `updated_at` TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP AFTER `updated_by`;

-- Backfill created_by from author for existing notes
UPDATE `conversation_notes` SET `created_by` = `author` WHERE `created_by` IS NULL;

-- Audit log: one row per create/edit/delete action on any note
CREATE TABLE IF NOT EXISTS `note_audit_log` (
  `id`              BIGINT        NOT NULL AUTO_INCREMENT,
  `note_id`         INT           NOT NULL,
  `conversation_id` VARCHAR(36)   NOT NULL,
  `action`          ENUM('create','edit','delete') NOT NULL,
  `user_id`         VARCHAR(255)  NOT NULL,
  `old_content`     TEXT          NULL,
  `new_content`     TEXT          NULL,
  `created_at`      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_nal_note`         (`note_id`),
  KEY `idx_nal_conversation` (`conversation_id`),
  KEY `idx_nal_user`         (`user_id`),
  KEY `idx_nal_created_at`   (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
