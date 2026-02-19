//! Avatar image caching service.
//!
//! Downloads and caches GitLab user avatars via session cookie authentication.
//! Avatars are stored as blobs in SQLite and served as data URIs to the frontend.

use crate::db::pool::DbPool;
use crate::error::AppError;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// TTL for cached avatars (24 hours).
const AVATAR_TTL_SECS: i64 = 24 * 60 * 60;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Download an avatar image using the GitLab session cookie.
pub async fn download_avatar(
    url: &str,
    cookie: &str,
    instance_url: &str,
) -> Result<(Vec<u8>, String), AppError> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::network(format!("Failed to create HTTP client: {}", e)))?;

    // Build the full URL if the avatar_url is relative
    let full_url = if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        format!("{}{}", instance_url.trim_end_matches('/'), url)
    };

    let response = client
        .get(&full_url)
        .header("Cookie", format!("_gitlab_session={}", cookie))
        .send()
        .await
        .map_err(|e| AppError::network(format!("Avatar download failed: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::network(format!(
            "Avatar download returned status {}",
            response.status()
        )));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();

    let data = response
        .bytes()
        .await
        .map_err(|e| AppError::network(format!("Failed to read avatar data: {}", e)))?;

    Ok((data.to_vec(), content_type))
}

/// Store or update the avatar URL during sync (without downloading).
pub async fn upsert_avatar_url(
    pool: &DbPool,
    instance_id: i64,
    username: &str,
    avatar_url: &str,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO user_avatars (instance_id, username, avatar_url)
        VALUES (?, ?, ?)
        ON CONFLICT(instance_id, username) DO UPDATE SET avatar_url = excluded.avatar_url
        "#,
    )
    .bind(instance_id)
    .bind(username)
    .bind(avatar_url)
    .execute(pool)
    .await?;

    Ok(())
}

/// Store downloaded avatar image data.
pub async fn store_avatar_data(
    pool: &DbPool,
    instance_id: i64,
    username: &str,
    data: &[u8],
    content_type: &str,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE user_avatars
        SET avatar_data = ?, content_type = ?, fetched_at = ?
        WHERE instance_id = ? AND username = ?
        "#,
    )
    .bind(data)
    .bind(content_type)
    .bind(now())
    .bind(instance_id)
    .bind(username)
    .execute(pool)
    .await?;

    Ok(())
}

/// Get a cached avatar as a data URI.
pub async fn get_avatar_data_uri(
    pool: &DbPool,
    instance_id: i64,
    username: &str,
) -> Result<Option<String>, AppError> {
    let row: Option<(Vec<u8>, String)> = sqlx::query_as(
        "SELECT avatar_data, content_type FROM user_avatars WHERE instance_id = ? AND username = ? AND avatar_data IS NOT NULL",
    )
    .bind(instance_id)
    .bind(username)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(data, ct)| format!("data:{};base64,{}", ct, STANDARD.encode(&data))))
}

/// Get cached avatars as data URIs in batch.
pub async fn get_avatar_data_uris_batch(
    pool: &DbPool,
    instance_id: i64,
    usernames: &[String],
) -> Result<HashMap<String, String>, AppError> {
    if usernames.is_empty() {
        return Ok(HashMap::new());
    }

    // Build a query with placeholders for all usernames
    let placeholders: Vec<&str> = usernames.iter().map(|_| "?").collect();
    let query = format!(
        "SELECT username, avatar_data, content_type FROM user_avatars WHERE instance_id = ? AND username IN ({}) AND avatar_data IS NOT NULL",
        placeholders.join(", ")
    );

    let mut q = sqlx::query_as::<_, (String, Vec<u8>, String)>(&query).bind(instance_id);
    for name in usernames {
        q = q.bind(name);
    }

    let rows = q.fetch_all(pool).await?;

    let mut result = HashMap::new();
    for (username, data, ct) in rows {
        result.insert(
            username,
            format!("data:{};base64,{}", ct, STANDARD.encode(&data)),
        );
    }

    Ok(result)
}

/// Sync avatars for a set of users: upsert URLs and download images if a session cookie is present.
pub async fn sync_avatars(
    pool: &DbPool,
    instance_id: i64,
    instance_url: &str,
    cookie: Option<&str>,
    users: &[(String, Option<String>)], // (username, avatar_url)
) -> Result<u32, AppError> {
    let mut count = 0u32;
    let cutoff = now() - AVATAR_TTL_SECS;

    for (username, avatar_url) in users {
        // Upsert the URL if we have one
        if let Some(url) = avatar_url {
            if let Err(e) = upsert_avatar_url(pool, instance_id, username, url).await {
                eprintln!("[avatar] Failed to upsert URL for {}: {}", username, e);
                continue;
            }
        }

        // Download if we have a cookie and the cache is stale
        if let Some(cookie) = cookie {
            // Check if we already have a fresh cache
            let fresh: Option<(i64,)> = sqlx::query_as(
                "SELECT fetched_at FROM user_avatars WHERE instance_id = ? AND username = ? AND avatar_data IS NOT NULL AND fetched_at > ?",
            )
            .bind(instance_id)
            .bind(username)
            .bind(cutoff)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);

            if fresh.is_some() {
                continue; // still fresh
            }

            // Get the avatar URL to download
            let url_row: Option<(String,)> = sqlx::query_as(
                "SELECT avatar_url FROM user_avatars WHERE instance_id = ? AND username = ? AND avatar_url IS NOT NULL",
            )
            .bind(instance_id)
            .bind(username)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);

            if let Some((url,)) = url_row {
                match download_avatar(&url, cookie, instance_url).await {
                    Ok((data, ct)) => {
                        if let Err(e) =
                            store_avatar_data(pool, instance_id, username, &data, &ct).await
                        {
                            eprintln!("[avatar] Failed to store data for {}: {}", username, e);
                        } else {
                            count += 1;
                        }
                    }
                    Err(e) => {
                        eprintln!("[avatar] Download failed for {}: {}", username, e);
                    }
                }
            }
        }
    }

    Ok(count)
}

/// Force-refresh all avatars for an instance (ignores TTL).
pub async fn refresh_all_avatars(
    pool: &DbPool,
    instance_id: i64,
    instance_url: &str,
    cookie: &str,
) -> Result<u32, AppError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT username, avatar_url FROM user_avatars WHERE instance_id = ? AND avatar_url IS NOT NULL",
    )
    .bind(instance_id)
    .fetch_all(pool)
    .await?;

    let mut count = 0u32;
    for (username, url) in &rows {
        match download_avatar(url, cookie, instance_url).await {
            Ok((data, ct)) => {
                if let Err(e) = store_avatar_data(pool, instance_id, username, &data, &ct).await {
                    eprintln!("[avatar] Failed to store data for {}: {}", username, e);
                } else {
                    count += 1;
                }
            }
            Err(e) => {
                eprintln!("[avatar] Refresh failed for {}: {}", username, e);
            }
        }
    }

    Ok(count)
}
