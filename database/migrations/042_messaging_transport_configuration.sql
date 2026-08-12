SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF OBJECT_ID(N'ops.messaging_configuration', N'U') IS NULL
BEGIN
    CREATE TABLE ops.messaging_configuration (
        configuration_id tinyint NOT NULL CONSTRAINT pk_messaging_configuration PRIMARY KEY,
        enabled bit NOT NULL CONSTRAINT df_messaging_configuration_enabled DEFAULT 0,
        test_mode bit NOT NULL CONSTRAINT df_messaging_configuration_test_mode DEFAULT 1,
        provider nvarchar(30) NOT NULL CONSTRAINT df_messaging_configuration_provider DEFAULT N'MicrosoftGraph',
        tenant_id nvarchar(100) NULL,
        client_id nvarchar(100) NULL,
        client_secret_protected nvarchar(max) NULL,
        sender_address nvarchar(320) NULL,
        sender_display_name nvarchar(200) NOT NULL CONSTRAINT df_messaging_configuration_sender_name DEFAULT N'i-Elevate',
        reply_to_address nvarchar(320) NULL,
        test_recipient nvarchar(320) NULL,
        application_url nvarchar(1000) NULL,
        poll_seconds int NOT NULL CONSTRAINT df_messaging_configuration_poll DEFAULT 10,
        smtp_host nvarchar(255) NOT NULL CONSTRAINT df_messaging_configuration_smtp_host DEFAULT N'smtp.office365.com',
        smtp_port int NOT NULL CONSTRAINT df_messaging_configuration_smtp_port DEFAULT 587,
        smtp_security nvarchar(30) NOT NULL CONSTRAINT df_messaging_configuration_smtp_security DEFAULT N'StartTls',
        smtp_authentication nvarchar(30) NOT NULL CONSTRAINT df_messaging_configuration_smtp_auth DEFAULT N'OAuth2',
        smtp_username nvarchar(320) NULL,
        smtp_password_protected nvarchar(max) NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        updated_at datetimeoffset NOT NULL CONSTRAINT df_messaging_configuration_updated_at DEFAULT sysutcdatetime(),
        row_version rowversion NOT NULL,
        CONSTRAINT ck_messaging_configuration_singleton CHECK (configuration_id = 1),
        CONSTRAINT ck_messaging_configuration_provider CHECK (provider IN (N'MicrosoftGraph', N'Smtp')),
        CONSTRAINT ck_messaging_configuration_poll CHECK (poll_seconds BETWEEN 2 AND 300),
        CONSTRAINT ck_messaging_configuration_smtp_port CHECK (smtp_port BETWEEN 1 AND 65535),
        CONSTRAINT ck_messaging_configuration_smtp_security CHECK (smtp_security IN (N'StartTls', N'SslOnConnect', N'None')),
        CONSTRAINT ck_messaging_configuration_smtp_auth CHECK (smtp_authentication IN (N'OAuth2', N'UsernamePassword', N'None')),
        CONSTRAINT fk_messaging_configuration_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id)
    );
END;
GO
