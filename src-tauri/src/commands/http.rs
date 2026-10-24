//! One request to the network, on a person's say-so.
//!
//! `docs.yml`: offline is the default, and the network is reached when the
//! user presses a button. This is the whole of what pressing one can do: one
//! GET over HTTPS, with a timeout and a size cap, returning the status and
//! the body. No cookies, no sessions, no POST. A shop page and a shop's item
//! JSON are what it is for.
//!
//! # Not a plugin command
//!
//! `plugin::commands` refuses a plugin-callable command whose name reaches
//! outside, and this one is not on that list. It is the application's, and
//! the application lends it to a plugin for the duration of an action the
//! person pressed -- see `plugin-host/commands.ts`, `pressedApiFor`. A panel
//! drawing is not a press and never gets it.

use std::time::Duration;

/// The most bytes a body may be. A shop's item JSON is a few kilobytes; a
/// page is a few hundred. Anything past this is not what a press was for.
pub const LIMIT: u64 = 8 * 1024 * 1024;

/// How long one request may take, in all.
pub const TIMEOUT: Duration = Duration::from_secs(15);

/// What came back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
}

/// Why a request did not happen or did not finish.
#[derive(Debug)]
pub enum HttpError {
    /// Not an `https://` URL. Plain HTTP is refused: whatever a plugin is
    /// told came from a shop should have come from the shop.
    NotHttps(String),
    /// The request failed: no network, a timeout, a refused connection.
    Failed(String),
    /// The body was larger than [`LIMIT`].
    TooLarge,
}

impl std::fmt::Display for HttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotHttps(url) => write!(f, "{url:?} is not an https URL"),
            Self::Failed(reason) => write!(f, "the request failed: {reason}"),
            Self::TooLarge => write!(f, "the response is larger than {LIMIT} bytes"),
        }
    }
}

impl std::error::Error for HttpError {}

/// The host an https URL names, or why it is not one.
pub fn host_of(url: &str) -> Result<String, HttpError> {
    let rest = url
        .strip_prefix("https://")
        .ok_or_else(|| HttpError::NotHttps(url.to_string()))?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.split('@').next_back().unwrap_or(host);
    let host = host.split(':').next().unwrap_or(host).to_ascii_lowercase();
    if host.is_empty() {
        return Err(HttpError::NotHttps(url.to_string()));
    }
    Ok(host)
}

/// GET one URL.
pub fn get(url: &str) -> Result<Response, HttpError> {
    host_of(url)?;

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .http_status_as_error(false)
        .user_agent("yukifile/0.1 (+https://github.com/tsiyukino/YukiFile)")
        .build()
        .into();

    let mut response = agent
        .get(url)
        .header("Accept", "application/json, text/html;q=0.9, */*;q=0.5")
        .call()
        .map_err(|error| HttpError::Failed(error.to_string()))?;

    let status = response.status().as_u16();
    let body = response
        .body_mut()
        .with_config()
        .limit(LIMIT)
        .read_to_vec()
        .map_err(|error| {
            if error.to_string().to_lowercase().contains("limit") {
                HttpError::TooLarge
            } else {
                HttpError::Failed(error.to_string())
            }
        })?;

    Ok(Response { status, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_is_a_url_here() {
        assert!(matches!(get("http://booth.pm/x"), Err(HttpError::NotHttps(_))));
        assert!(matches!(get("ftp://booth.pm/x"), Err(HttpError::NotHttps(_))));
        assert!(matches!(get("booth.pm/x"), Err(HttpError::NotHttps(_))));
        assert!(matches!(get("https://"), Err(HttpError::NotHttps(_))));
    }

    #[test]
    fn the_host_is_read_out_of_the_url_and_nothing_else_is() {
        assert_eq!(host_of("https://booth.pm/en/items/1.json").unwrap(), "booth.pm");
        assert_eq!(host_of("https://Shop.Booth.pm:443/items/1?x=1#f").unwrap(), "shop.booth.pm");
        assert_eq!(host_of("https://user@booth.pm/x").unwrap(), "booth.pm");
    }
}
