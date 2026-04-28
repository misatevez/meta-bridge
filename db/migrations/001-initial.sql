-- meta-bridge schema · migration 001-initial
-- Target: MariaDB 8.4.x (OCI managed) · database `meta_bridge`
-- Apply with: mysql -h 129.213.101.91 -u meta_bridge -p meta_bridge < db/migrations/001-initial.sql
-- Idempotent: every CREATE uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS `wa_messages` (
  `id`                   BIGINT          NOT NULL AUTO_INCREMENT,
  `wamid`                VARCHAR(64)     NOT NULL,
  `direction`            ENUM('in','out') NOT NULL,
  `wa_id`                VARCHAR(32)     NOT NULL,
  `contact_id_suitecrm`  VARCHAR(36)     NULL,
  `body`                 TEXT            NULL,
  `media_url`            VARCHAR(512)    NULL,
  `status`               VARCHAR(32)     NULL,
  `raw_payload`          JSON            NULL,
  `created_at`           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wa_messages_wamid` (`wamid`),
  KEY `idx_wa_messages_wa_id` (`wa_id`),
  KEY `idx_wa_messages_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bridge_oauth_tokens` (
  `id`            INT          NOT NULL,
  `access_token`  TEXT         NOT NULL,
  `expires_at`    TIMESTAMP    NOT NULL,
  `updated_at`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wa_contacts_map` (
  `wa_id`               VARCHAR(32)  NOT NULL,
  `contact_id_suitecrm` VARCHAR(36)  NOT NULL,
  `created_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`wa_id`),
  KEY `idx_wa_contacts_map_contact_id` (`contact_id_suitecrm`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
