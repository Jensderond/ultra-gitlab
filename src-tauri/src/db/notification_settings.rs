//! Database queries for notification settings.

use crate::models::NotificationSettings;

/// Get the current notification settings (single-row pattern, id=1).
pub async fn get_notification_settings(
    pool: &sqlx::SqlitePool,
) -> Result<NotificationSettings, sqlx::Error> {
    sqlx::query_as::<_, NotificationSettings>(
        "SELECT mr_ready_to_merge, pipeline_status_pinned, native_notifications_enabled FROM notification_settings WHERE id = 1",
    )
    .fetch_one(pool)
    .await
}

/// Update notification settings (single-row pattern, id=1).
pub async fn update_notification_settings(
    pool: &sqlx::SqlitePool,
    settings: &NotificationSettings,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE notification_settings
        SET mr_ready_to_merge = ?,
            pipeline_status_pinned = ?,
            native_notifications_enabled = ?
        WHERE id = 1
        "#,
    )
    .bind(settings.mr_ready_to_merge)
    .bind(settings.pipeline_status_pinned)
    .bind(settings.native_notifications_enabled)
    .execute(pool)
    .await?;

    Ok(())
}
