use serde_json::Value;
use url::Url;

pub const AUTOFILL_MATCH_MODES: &[&str] = &[
    "base-domain",
    "exact-host",
    "subdomain",
    "url-prefix",
    "never",
];

pub fn normalize_domain(value: &str, strip_www: bool) -> String {
    let mut v = value.trim().to_lowercase();
    if v.is_empty() {
        return String::new();
    }

    if v.contains("://") {
        if let Ok(parsed) = Url::parse(&v) {
            v = parsed.host_str().unwrap_or("").to_string();
        } else {
            v = v.split("://").nth(1).unwrap_or("").to_string();
            if let Some(slash_idx) = v.find('/') {
                v.truncate(slash_idx);
            }
        }
    } else if let Some(slash_idx) = v.find('/') {
        v.truncate(slash_idx);
    }

    if let Some(at_idx) = v.rfind('@') {
        v = v[at_idx + 1..].to_string();
    }

    if let Some(colon_idx) = v.find(':') {
        v.truncate(colon_idx);
    }

    let mut trimmed = v.trim_matches('.').to_string();
    if strip_www && trimmed.starts_with("www.") {
        trimmed = trimmed[4..].to_string();
    }
    trimmed
}

pub const MULTIPART_TLDS: &[&str] = &[
    "co.uk", "org.uk", "me.uk", "net.uk", "ltd.uk", "plc.uk", "ac.uk", "gov.uk",
    "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn", "mil.cn",
    "com.hk", "org.hk", "edu.hk", "gov.hk", "net.hk", "idv.hk",
    "com.tw", "org.tw", "gov.tw", "edu.tw", "net.tw", "idv.tw", "club.tw",
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au", "id.au",
    "co.jp", "ne.jp", "or.jp", "go.jp", "ac.jp", "ed.jp", "ad.jp", "gr.jp", "lg.jp",
    "co.kr", "ne.kr", "or.kr", "re.kr", "pe.kr", "go.kr", "mil.kr", "ac.kr",
    "com.sg", "net.sg", "org.sg", "gov.sg", "edu.sg", "per.sg",
    "com.my", "net.my", "org.my", "gov.my", "edu.my", "mil.my",
    "com.br", "net.br", "org.br", "gov.br", "edu.br",
    "co.in", "net.in", "org.in", "gen.in", "firm.in", "ind.in", "nic.in", "ac.in", "edu.in", "res.in", "gov.in",
    "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz", "edu.nz",
    "co.za", "net.za", "org.za", "web.za", "gov.za", "ac.za", "edu.za",
    "com.mx", "net.mx", "org.mx", "edu.mx", "gob.mx",
    "com.ru", "net.ru", "org.ru", "pp.ru",
    "github.io", "gitlab.io", "pages.dev", "vercel.app", "azurewebsites.net", "herokuapp.com", "cloudfront.net",
];

pub const SECONDARY_TOKENS: &[&str] = &[
    "com", "co", "net", "ne", "org", "or", "gov", "go", "gob", "edu", "ed",
    "ac", "mil", "biz", "info", "ltd", "plc", "gen", "firm", "ind", "nic",
    "res", "asn", "idv", "id", "web", "pp", "asso",
];

pub const CN_PROVINCES: &[&str] = &[
    "bj", "sh", "tj", "cq", "he", "sx", "nm", "ln", "jl", "hl", "js", "zj",
    "ah", "fj", "jx", "sd", "ha", "hb", "hn", "gd", "gx", "hi", "sc", "gz",
    "yn", "xz", "sn", "gs", "qh", "nx", "xj", "tw", "hk", "mo",
];

pub fn extract_base_domain(raw_host: &str) -> String {
    let host = normalize_domain(raw_host, false);
    if host.is_empty() {
        return String::new();
    }
    if host.parse::<std::net::IpAddr>().is_ok() || host.starts_with('[') {
        return host;
    }
    if !host.contains('.') {
        return host;
    }
    let labels: Vec<&str> = host.split('.').filter(|s| !s.is_empty()).collect();
    if labels.is_empty() {
        return String::new();
    }
    let tld = labels[labels.len() - 1];
    if matches!(tld, "localhost" | "local" | "internal" | "lan") {
        return tld.to_string();
    }
    if labels.len() <= 2 {
        return host;
    }
    let sld = labels[labels.len() - 2];
    let two_part = format!("{}.{}", sld, tld);
    let is_multi_part = MULTIPART_TLDS.contains(&two_part.as_str())
        || (tld.len() == 2 && (SECONDARY_TOKENS.contains(&sld) || (tld == "cn" && CN_PROVINCES.contains(&sld))));

    if is_multi_part {
        if labels.len() >= 3 {
            labels[labels.len() - 3..].join(".")
        } else {
            host
        }
    } else {
        labels[labels.len() - 2..].join(".")
    }
}

pub fn domain_matches(hostname: &str, saved_domain: &str) -> bool {
    let host = normalize_domain(hostname, true);
    let domain = normalize_domain(saved_domain, true);
    if host.is_empty() || domain.is_empty() {
        return false;
    }
    if domain.contains('*') {
        if domain.starts_with("*.") && !domain[2..].contains('*') {
            let base = &domain[2..];
            return host == base || host.ends_with(&format!(".{}", base));
        }
        let pattern = format!("^{}$", regex::escape(&domain).replace(r"\*", r".*"));
        if let Ok(re) = regex::Regex::new(&pattern) {
            return re.is_match(&host);
        }
        return false;
    }
    if host == domain || host.ends_with(&format!(".{}", domain)) || domain.ends_with(&format!(".{}", host)) {
        return true;
    }
    let host_base = extract_base_domain(&host);
    let domain_base = extract_base_domain(&domain);
    !host_base.is_empty() && host_base == domain_base
}

pub fn normalize_autofill_match_mode(value: Option<&str>) -> &str {
    match value {
        Some(m) if AUTOFILL_MATCH_MODES.contains(&m) => m,
        _ => "base-domain",
    }
}

pub fn normalize_url_prefix(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let parsed = match Url::parse(trimmed) {
        Ok(u) => u,
        Err(_) => return String::new(),
    };

    let scheme = parsed.scheme().to_lowercase();
    if scheme != "http" && scheme != "https" {
        return String::new();
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return String::new();
    }

    let host = match parsed.host_str() {
        Some(h) => h.to_lowercase().trim_matches('.').to_string(),
        None => return String::new(),
    };
    if host.is_empty() {
        return String::new();
    }

    let port = parsed.port();
    let default_port = if scheme == "http" { 80 } else { 443 };
    let netloc = match port {
        Some(p) if p != default_port => format!("{}:{}", host, p),
        _ => host,
    };

    let path = parsed.path();
    let norm_path = if path.is_empty() { "/" } else { path };

    let mut res = format!("{}://{}{}", scheme, netloc, norm_path);
    if let Some(query) = parsed.query() {
        res.push('?');
        res.push_str(query);
    }
    res
}

pub fn autofill_rule_matches(
    hostname: &str,
    page_url: &str,
    saved_rule: &str,
    mode: &str,
) -> bool {
    let normalized_mode = normalize_autofill_match_mode(Some(mode));
    if normalized_mode == "never" {
        return false;
    }

    let preserve_www = normalized_mode == "exact-host" || normalized_mode == "subdomain";
    let host = normalize_domain(hostname, !preserve_www);

    if normalized_mode == "url-prefix" {
        let page = normalize_url_prefix(page_url);
        let rule = normalize_url_prefix(saved_rule);
        if page.is_empty() || rule.is_empty() {
            return false;
        }

        if let (Ok(parsed_page), Ok(parsed_rule)) = (Url::parse(&page), Url::parse(&rule)) {
            if !host.is_empty() && normalize_domain(parsed_page.host_str().unwrap_or(""), true) != host {
                return false;
            }
            if parsed_page.scheme() != parsed_rule.scheme()
                || parsed_page.host_str() != parsed_rule.host_str()
                || parsed_page.port() != parsed_rule.port()
            {
                return false;
            }
        } else {
            return false;
        }

        if page == rule {
            return true;
        }
        if !page.starts_with(&rule) {
            return false;
        }
        let last_char = rule.chars().last().unwrap_or(' ');
        if "/?&=".contains(last_char) {
            return true;
        }
        let next_char = page[rule.len()..].chars().next().unwrap_or(' ');
        return "/?&".contains(next_char);
    }

    let domain = normalize_domain(saved_rule, !preserve_www);
    if host.is_empty() || domain.is_empty() {
        return false;
    }

    if domain.contains('*') {
        if domain.starts_with("*.") && !domain[2..].contains('*') {
            let base = &domain[2..];
            return host == base || host.ends_with(&format!(".{}", base));
        }
        let pattern = format!("^{}$", regex::escape(&domain).replace(r"\*", r".*"));
        if let Ok(re) = regex::Regex::new(&pattern) {
            return re.is_match(&host);
        }
        return false;
    }

    match normalized_mode {
        "exact-host" => host == domain,
        "subdomain" => host != domain && host.ends_with(&format!(".{}", domain)),
        _ => {
            if host == domain || host.ends_with(&format!(".{}", domain)) || domain.ends_with(&format!(".{}", host)) {
                return true;
            }
            let host_base = extract_base_domain(&host);
            let domain_base = extract_base_domain(&domain);
            !host_base.is_empty() && host_base == domain_base
        }
    }
}

pub fn entry_matches_page(entry: &Value, hostname: &str, page_url: &str) -> bool {
    let mode = entry
        .get("autofillMatchMode")
        .and_then(|v| v.as_str())
        .unwrap_or("base-domain");

    if let Some(domains) = entry.get("domains").and_then(|d| d.as_array()) {
        for d in domains {
            if let Some(rule) = d.as_str() {
                if autofill_rule_matches(hostname, page_url, rule, mode) {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_domain() {
        assert_eq!(normalize_domain("https://www.google.com/path", true), "google.com");
        assert_eq!(normalize_domain("https://www.google.com/path", false), "www.google.com");
        assert_eq!(normalize_domain("user@sub.example.com:8080/abc", true), "sub.example.com");
    }

    #[test]
    fn test_domain_matches() {
        assert!(domain_matches("login.example.com", "example.com"));
        assert!(domain_matches("example.com", "example.com"));
        assert!(!domain_matches("example.org", "example.com"));
        assert!(domain_matches("api.internal.corp", "*.internal.corp"));
    }

    #[test]
    fn test_extract_base_domain() {
        assert_eq!(extract_base_domain("example.com"), "example.com");
        assert_eq!(extract_base_domain("sub.example.com"), "example.com");
        assert_eq!(extract_base_domain("a.b.c.example.com"), "example.com");
        assert_eq!(extract_base_domain("example.com.cn"), "example.com.cn");
        assert_eq!(extract_base_domain("sub.example.com.cn"), "example.com.cn");
        assert_eq!(extract_base_domain("login.example.co.uk"), "example.co.uk");
        assert_eq!(extract_base_domain("user.github.io"), "user.github.io");
        assert_eq!(extract_base_domain("sub.user.github.io"), "user.github.io");
        assert_eq!(extract_base_domain("localhost"), "localhost");
        assert_eq!(extract_base_domain("sub.localhost"), "localhost");
        assert_eq!(extract_base_domain("127.0.0.1"), "127.0.0.1");
    }

    #[test]
    fn test_autofill_rule_matches() {
        // base-domain matching
        assert!(autofill_rule_matches("login.example.com", "", "example.com", "base-domain"));
        assert!(autofill_rule_matches("example.com", "", "login.example.com", "base-domain"));
        assert!(autofill_rule_matches("other.example.com", "", "login.example.com", "base-domain"));
        assert!(autofill_rule_matches("a.b.example.com", "", "login.example.com", "base-domain"));
        assert!(autofill_rule_matches("sub.example.com.cn", "", "other.example.com.cn", "base-domain"));
        assert!(autofill_rule_matches("example.com.cn", "", "sub.example.com.cn", "base-domain"));
        assert!(autofill_rule_matches("sub.example.com", "", "*.example.com", "base-domain"));
        assert!(autofill_rule_matches("a.b.example.com", "", "*.example.com", "base-domain"));
        assert!(autofill_rule_matches("example.com", "", "*.example.com", "base-domain"));
        assert!(!autofill_rule_matches("evil-example.com", "", "example.com", "base-domain"));
        assert!(!autofill_rule_matches("example.org", "", "example.com", "base-domain"));

        // other modes
        assert!(!autofill_rule_matches("example.com", "", "example.com", "never"));
        assert!(!autofill_rule_matches("example.com", "", "example.com", "subdomain"));
        assert!(autofill_rule_matches("sub.example.com", "", "example.com", "subdomain"));
        assert!(!autofill_rule_matches("other.example.com", "", "sub.example.com", "subdomain"));
        assert!(autofill_rule_matches("login.example.com", "", "login.example.com", "exact-host"));
        assert!(!autofill_rule_matches("example.com", "", "login.example.com", "exact-host"));
        assert!(!autofill_rule_matches("other.example.com", "", "login.example.com", "exact-host"));
        assert!(autofill_rule_matches(
            "example.com",
            "https://example.com/login?step=1",
            "https://example.com/login",
            "url-prefix"
        ));
    }
}
