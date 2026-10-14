use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::env;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

const REQUEST_SCHEMA: &str = "tailrocks.repo-merge-request/v1";
const TARGET_SCHEMA: &str = "tailrocks.target-receipt/v1";
const CAMPAIGN_SCHEMA: &str = "tailrocks.campaign-state/v1";
const SNAPSHOT_SCHEMA: &str = "tailrocks.snapshot/v1";
const LEASE_SCHEMA: &str = "tailrocks.campaign-lease/v1";
const TARGET_LEASE_SCHEMA: &str = "tailrocks.target-lease/v1";
const RESOLUTION_SCHEMA: &str = "tailrocks.source-resolution/v1";
const RECEIPT_SCHEMA: &str = "tailrocks.campaign-receipt/v1";

#[derive(Debug, Clone)]
struct HelperError(String);

impl std::fmt::Display for HelperError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl std::error::Error for HelperError {}

type Result<T> = std::result::Result<T, HelperError>;

struct StateMutationLock {
    file: std::fs::File,
}

impl Drop for StateMutationLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceSelector {
    pub kind: String,
    pub raw: String,
    pub canonical: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fragment: Option<String>,
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Request {
    pub schema: String,
    pub raw_text: String,
    pub repository: Option<String>,
    pub target_branch: String,
    pub target_explicit: bool,
    pub audit_only: bool,
    pub cleanup: String,
    pub all_work: bool,
    pub local_only: bool,
    pub resume: Option<String>,
    pub sources: Vec<SourceSelector>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceResolution {
    pub schema: String,
    pub selector: SourceSelector,
    pub repository: String,
    pub canonical: String,
    pub kind: String,
    pub source_ref: Option<String>,
    pub head_branch: Option<String>,
    pub head_oid: Option<String>,
    pub base_branch: Option<String>,
    pub base_oid: Option<String>,
    pub number: Option<u64>,
    pub state: Option<String>,
    pub draft: Option<bool>,
    pub protected: Option<bool>,
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResolutionSet {
    pub schema: String,
    pub repository: String,
    pub resolved_at_unix: u64,
    pub sources: Vec<SourceResolution>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TargetReceipt {
    pub schema: String,
    pub repo_path: String,
    pub target_branch: String,
    pub target_ref: String,
    pub target_oid: String,
    pub remote: Option<String>,
    pub advertised_default_branch: Option<String>,
    pub checked_at_unix: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JournalEntry {
    pub sequence: u64,
    pub event: String,
    pub phase: String,
    pub status: String,
    pub at_unix: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CampaignState {
    pub schema: String,
    pub campaign_id: String,
    pub created_at_unix: u64,
    pub repository: String,
    pub repo_path: String,
    pub target: TargetReceipt,
    pub request: Request,
    pub frozen_sources: Vec<SourceSelector>,
    #[serde(default)]
    pub resolved_sources: Vec<SourceResolution>,
    #[serde(default)]
    pub source_resolution_at_unix: Option<u64>,
    pub scope: String,
    pub initial_target_oid: String,
    pub current_target_oid: String,
    pub audit_only: bool,
    pub local_only: bool,
    pub configuration_digest: String,
    #[serde(default)]
    pub source_resolution_digest: String,
    pub scan_coverage: Vec<String>,
    pub decisions: Vec<String>,
    pub receipt_refs: Vec<String>,
    pub recovery_index: Vec<String>,
    pub lock_path: String,
    #[serde(default)]
    pub target_lock_path: String,
    pub status: String,
    pub phase: String,
    pub journal: Vec<JournalEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CampaignLease {
    pub schema: String,
    pub campaign_id: String,
    pub repository: String,
    pub repo_path: String,
    pub target_branch: String,
    pub target_ref: String,
    pub target_oid: String,
    pub owner_pid: u32,
    pub acquired_at_unix: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TargetLease {
    pub schema: String,
    pub campaign_id: String,
    pub repository: String,
    pub repo_path: String,
    pub target_branch: String,
    pub target_ref: String,
    pub target_oid: String,
    pub owner_pid: u32,
    pub acquired_at_unix: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SnapshotFile {
    path: String,
    kind: String,
    sha256: String,
    size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SnapshotManifest {
    schema: String,
    created_at_unix: u64,
    repo_path: String,
    head_oid: String,
    head_ref: Option<String>,
    files: Vec<SnapshotFile>,
    staged_patch_sha256: String,
    unstaged_patch_sha256: String,
    status_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct RestoreReceipt {
    schema: String,
    snapshot_schema: String,
    bundle_verified: bool,
    head_verified: bool,
    staged_patch_verified: bool,
    unstaged_patch_verified: bool,
    files_verified: usize,
    ignored_or_untracked_verified: usize,
    verified_at_unix: u64,
}

fn main() {
    if let Err(error) = dispatch(env::args_os().skip(1).collect()) {
        eprintln!("repo-merge-helper: {error}");
        std::process::exit(2);
    }
}

fn dispatch(args: Vec<OsString>) -> Result<()> {
    let command = args
        .first()
        .and_then(|value| value.to_str())
        .ok_or_else(|| HelperError(usage()))?;
    match command {
        "help" | "--help" | "-h" => {
            println!("{}", usage());
            Ok(())
        }
        "parse-request" => {
            let text = option_value(&args[1..], "--text")
                .or_else(|| read_stdin_if_available().ok())
                .ok_or_else(|| HelperError("parse-request needs --text TEXT or stdin".into()))?;
            let request = parse_request(&text)?;
            print_json(&request)
        }
        "target-check" => {
            let repo_path = required_path(&args[1..], "--repo-path")?;
            let branch = required_string(&args[1..], "--target-branch")?;
            let remote = option_value(&args[1..], "--remote");
            let receipt = check_target(&repo_path, &branch, remote.as_deref())?;
            print_json(&receipt)
        }
        "resolve-selectors" => {
            let repo_path = required_path(&args[1..], "--repo-path")?;
            let request_file = required_path(&args[1..], "--request-file")?;
            let request: Request = read_json(&request_file)?;
            let resolved = resolve_selectors(&repo_path, &request)?;
            print_json(&resolved)
        }
        "campaign-init" => {
            let state_dir = required_path(&args[1..], "--state-dir")?;
            let repo_path = required_path(&args[1..], "--repo-path")?;
            let request_file = required_path(&args[1..], "--request-file")?;
            let target_file = required_path(&args[1..], "--target-receipt")?;
            let request: Request = read_json(&request_file)?;
            let target: TargetReceipt = read_json(&target_file)?;
            let resolution = option_value(&args[1..], "--resolution-file")
                .map(PathBuf::from)
                .map(|path| read_json(&path))
                .transpose()?;
            let state = init_campaign(&state_dir, &repo_path, request, target, resolution)?;
            print_json(&state)
        }
        "campaign-resume" => {
            let state_dir = required_path(&args[1..], "--state-dir")?;
            let campaign_id = required_string(&args[1..], "--campaign-id")?;
            let override_target = option_value(&args[1..], "--target-branch");
            let state_path = state_dir.join(format!("{campaign_id}.json"));
            let state: CampaignState = read_json(&state_path)?;
            if state.schema != CAMPAIGN_SCHEMA {
                return Err(HelperError("unsupported campaign state schema".into()));
            }
            if state.status != "complete" {
                ensure_campaign_lease(&state)?;
            }
            if let Some(target) = override_target {
                if target != state.target.target_branch {
                    return Err(HelperError(format!(
                        "resume target conflict: recorded={} requested={target}; start a new scoped campaign",
                        state.target.target_branch
                    )));
                }
            }
            print_json(&state)
        }
        "campaign-observe" => {
            let state_dir = required_path(&args[1..], "--state-dir")?;
            let campaign_id = required_string(&args[1..], "--campaign-id")?;
            let target_file = required_path(&args[1..], "--target-receipt")?;
            let state_path = state_dir.join(format!("{campaign_id}.json"));
            let _mutation_lock = acquire_state_mutation_lock(&state_path)?;
            let mut state: CampaignState = read_json(&state_path)?;
            let target: TargetReceipt = read_json(&target_file)?;
            observe_campaign(&state_path, &mut state, target)?;
            print_json(&state)
        }
        "campaign-journal" => {
            let state_dir = required_path(&args[1..], "--state-dir")?;
            let campaign_id = required_string(&args[1..], "--campaign-id")?;
            let event = required_string(&args[1..], "--event")?;
            let phase = required_string(&args[1..], "--phase")?;
            let status = required_string(&args[1..], "--status")?;
            let state_path = state_dir.join(format!("{campaign_id}.json"));
            let _mutation_lock = acquire_state_mutation_lock(&state_path)?;
            let mut state: CampaignState = read_json(&state_path)?;
            ensure_campaign_lease(&state)?;
            if event == "campaign-complete"
                && (phase != "complete"
                    || status != "complete"
                    || !receipts_support_completion(&state)
                    || !state
                        .journal
                        .iter()
                        .any(|entry| entry.event == "target-observed"))
            {
                return Err(HelperError(
                    "campaign completion requires target observation and phase-complete campaign receipts"
                        .into(),
                ));
            }
            if status == "complete" && event != "campaign-complete" {
                return Err(HelperError(
                    "only campaign-complete may set status=complete".into(),
                ));
            }
            let sequence = state.journal.len() as u64 + 1;
            state.journal.push(JournalEntry {
                sequence,
                event,
                phase: phase.clone(),
                status: status.clone(),
                at_unix: now_unix(),
            });
            state.phase = phase;
            state.status = status;
            write_json_atomic(&state_path, &state)?;
            if state.status == "complete" {
                release_campaign_lease(&state)?;
            }
            print_json(&state)
        }
        "campaign-attach-receipt" => {
            let state_dir = required_path(&args[1..], "--state-dir")?;
            let campaign_id = required_string(&args[1..], "--campaign-id")?;
            let receipt_path = required_path(&args[1..], "--receipt")?;
            let state_path = state_dir.join(format!("{campaign_id}.json"));
            let _mutation_lock = acquire_state_mutation_lock(&state_path)?;
            let mut state: CampaignState = read_json(&state_path)?;
            ensure_campaign_lease(&state)?;
            let receipt_path = fs::canonicalize(&receipt_path)
                .map_err(|_| HelperError("receipt path is missing or not accessible".into()))?;
            let receipt: serde_json::Value = read_json(&receipt_path)?;
            if !receipt_matches_campaign(&receipt, &state) {
                return Err(HelperError(
                    "receipt schema, campaign, scope, source, phase, hash, or target binding is invalid".into(),
                ));
            }
            let receipt_path = receipt_path.to_string_lossy().into_owned();
            if !state.receipt_refs.contains(&receipt_path) {
                state.receipt_refs.push(receipt_path);
                write_json_atomic(&state_path, &state)?;
            }
            print_json(&state)
        }
        "campaign-release" => {
            let state_dir = required_path(&args[1..], "--state-dir")?;
            let campaign_id = required_string(&args[1..], "--campaign-id")?;
            let state_path = state_dir.join(format!("{campaign_id}.json"));
            let _mutation_lock = acquire_state_mutation_lock(&state_path)?;
            let state: CampaignState = read_json(&state_path)?;
            release_campaign_lease(&state)?;
            print_json(&state)
        }
        "snapshot-create" => {
            let repo_path = required_path(&args[1..], "--repo-path")?;
            let output = required_path(&args[1..], "--output")?;
            let manifest = create_snapshot(&repo_path, &output)?;
            print_json(&manifest)
        }
        "snapshot-restore-test" => {
            let snapshot = required_path(&args[1..], "--snapshot")?;
            let output = required_path(&args[1..], "--output")?;
            let receipt = restore_test(&snapshot, &output)?;
            print_json(&receipt)
        }
        _ => Err(HelperError(format!(
            "unknown command {command}\n{}",
            usage()
        ))),
    }
}

fn usage() -> String {
    "usage: helper <parse-request|target-check|resolve-selectors|campaign-init|campaign-resume|campaign-observe|campaign-journal|campaign-attach-receipt|campaign-release|snapshot-create|snapshot-restore-test> ...".into()
}

fn print_json<T: Serialize>(value: &T) -> Result<()> {
    println!(
        "{}",
        serde_json::to_string_pretty(value)
            .map_err(|error| HelperError(format!("json encode failed: {error}")))?
    );
    Ok(())
}

fn option_value(args: &[OsString], name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    args.iter().enumerate().find_map(|(index, arg)| {
        let text = arg.to_str()?;
        if let Some(value) = text.strip_prefix(&prefix) {
            return Some(value.to_string());
        }
        if text == name {
            return args
                .get(index + 1)
                .and_then(|value| value.to_str())
                .map(str::to_owned);
        }
        None
    })
}

fn required_string(args: &[OsString], name: &str) -> Result<String> {
    option_value(args, name).ok_or_else(|| HelperError(format!("missing {name}")))
}

fn required_path(args: &[OsString], name: &str) -> Result<PathBuf> {
    Ok(PathBuf::from(required_string(args, name)?))
}

fn read_stdin_if_available() -> io::Result<String> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    if input.is_empty() {
        Err(io::Error::new(io::ErrorKind::UnexpectedEof, "empty stdin"))
    } else {
        Ok(input)
    }
}

fn parse_request(text: &str) -> Result<Request> {
    let tokens = tokenize(text)?;
    let mut repository = None;
    let mut target_branch = "main".to_string();
    let mut target_explicit = false;
    let mut audit_only = false;
    let mut cleanup = "resolved".to_string();
    let mut all_work = false;
    let mut local_only = false;
    let mut resume = None;
    let mut cleanup_explicit = false;
    let mut sources = Vec::new();
    let mut index = 0;
    let mut after_delimiter = false;

    while index < tokens.len() {
        let token = &tokens[index];
        if !after_delimiter && token == "--" {
            after_delimiter = true;
            index += 1;
            continue;
        }
        if !after_delimiter && token == "--audit-only" {
            audit_only = true;
        } else if !after_delimiter && token == "--all-work" {
            all_work = true;
        } else if !after_delimiter && token == "--local-only" {
            local_only = true;
        } else if !after_delimiter && token == "--help" {
            return Err(HelperError(usage()));
        } else if !after_delimiter && token == "--target-branch" {
            if target_explicit {
                return Err(HelperError("duplicate --target-branch".into()));
            }
            index += 1;
            target_branch = tokens
                .get(index)
                .ok_or_else(|| HelperError("--target-branch needs a value".into()))?
                .clone();
            target_explicit = true;
            validate_branch_text(&target_branch)?;
        } else if !after_delimiter && token.starts_with("--target-branch=") {
            if target_explicit {
                return Err(HelperError("duplicate --target-branch".into()));
            }
            target_branch = token["--target-branch=".len()..].to_string();
            target_explicit = true;
            validate_branch_text(&target_branch)?;
        } else if !after_delimiter && token == "--repo" {
            if repository.is_some() {
                return Err(HelperError("duplicate --repo".into()));
            }
            index += 1;
            let value = tokens
                .get(index)
                .ok_or_else(|| HelperError("--repo needs a value".into()))?;
            repository = Some(normalize_repository(value)?);
        } else if !after_delimiter && token.starts_with("--repo=") {
            if repository.is_some() {
                return Err(HelperError("duplicate --repo".into()));
            }
            repository = Some(normalize_repository(&token["--repo=".len()..])?);
        } else if !after_delimiter && token == "--cleanup" {
            if cleanup_explicit {
                return Err(HelperError("duplicate --cleanup".into()));
            }
            index += 1;
            cleanup = tokens
                .get(index)
                .ok_or_else(|| HelperError("--cleanup needs resolved or none".into()))?
                .clone();
            validate_cleanup(&cleanup)?;
            cleanup_explicit = true;
        } else if !after_delimiter && token.starts_with("--cleanup=") {
            if cleanup_explicit {
                return Err(HelperError("duplicate --cleanup".into()));
            }
            cleanup = token["--cleanup=".len()..].to_string();
            validate_cleanup(&cleanup)?;
            cleanup_explicit = true;
        } else if !after_delimiter && token == "--resume" {
            if resume.is_some() {
                return Err(HelperError("duplicate --resume".into()));
            }
            index += 1;
            resume = Some(
                tokens
                    .get(index)
                    .ok_or_else(|| HelperError("--resume needs a campaign id".into()))?
                    .clone(),
            );
        } else if !after_delimiter && token.starts_with("--resume=") {
            if resume.is_some() {
                return Err(HelperError("duplicate --resume".into()));
            }
            resume = Some(token["--resume=".len()..].to_string());
        } else if !after_delimiter && token.starts_with('-') {
            return Err(HelperError(format!("unknown option {token}")));
        } else {
            sources.push(parse_selector(token)?);
        }
        index += 1;
    }

    if all_work && !sources.is_empty() {
        return Err(HelperError(
            "--all-work is mutually exclusive with source selectors".into(),
        ));
    }
    if resume.is_some() && (!sources.is_empty() || all_work) {
        return Err(HelperError(
            "--resume cannot include selectors or --all-work".into(),
        ));
    }
    if resume.is_none() && !all_work && sources.is_empty() {
        return Err(HelperError(
            "no selectors: provide SOURCES or explicitly use --all-work or --resume".into(),
        ));
    }

    let mut request = Request {
        schema: REQUEST_SCHEMA.into(),
        raw_text: text.into(),
        repository,
        target_branch,
        target_explicit,
        audit_only,
        cleanup,
        all_work,
        local_only,
        resume,
        sources,
    };
    bind_url_repositories(&mut request)?;
    let mut merged = BTreeMap::<String, SourceSelector>::new();
    for source in std::mem::take(&mut request.sources) {
        if let Some(existing) = merged.get_mut(&source.canonical) {
            existing.provenance.extend(source.provenance);
        } else {
            merged.insert(source.canonical.clone(), source);
        }
    }
    request.sources = merged.into_values().collect();
    Ok(request)
}

fn tokenize(text: &str) -> Result<Vec<String>> {
    if text.contains('\0') {
        return Err(HelperError("arguments contain NUL".into()));
    }
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escaped = false;
    let mut started = false;
    for character in text.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            started = true;
            continue;
        }
        match quote {
            Some('\'') => {
                if character == '\'' {
                    quote = None;
                } else {
                    current.push(character);
                }
                started = true;
            }
            Some('"') => match character {
                '"' => quote = None,
                '\\' => escaped = true,
                _ => current.push(character),
            },
            Some(_) => {
                current.push(character);
                started = true;
            }
            None => match character {
                '\\' => {
                    escaped = true;
                    started = true;
                }
                '\'' | '"' => {
                    quote = Some(character);
                    started = true;
                }
                c if c.is_whitespace() => {
                    if started {
                        tokens.push(std::mem::take(&mut current));
                        started = false;
                    }
                }
                _ => {
                    current.push(character);
                    started = true;
                }
            },
        }
    }
    if escaped || quote.is_some() {
        return Err(HelperError(
            "unterminated quote or escape in arguments".into(),
        ));
    }
    if started {
        tokens.push(current);
    }
    Ok(tokens)
}

fn parse_selector(raw: &str) -> Result<SourceSelector> {
    if raw.is_empty() {
        return Err(HelperError("empty source selector".into()));
    }
    if let Some(number) = raw.strip_prefix('#').and_then(parse_positive_number) {
        return Ok(pr_selector(raw, number));
    }
    if let Some(number) = raw.strip_prefix("pr:").and_then(parse_positive_number) {
        return Ok(pr_selector(raw, number));
    }
    if let Some(number) = raw.parse::<u64>().ok().filter(|value| *value > 0) {
        return Ok(pr_selector(raw, number));
    }
    if let Some(branch) = raw.strip_prefix("branch:") {
        validate_branch_text(branch)?;
        return Ok(branch_selector(raw, branch, None));
    }
    if raw.starts_with("https://") || raw.starts_with("http://") {
        return parse_url_selector(raw);
    }
    validate_branch_text(raw)?;
    let (qualified, branch) = if let Some(value) = raw.strip_prefix("refs/heads/") {
        (Some("full-ref".into()), value.to_string())
    } else if let Some(value) = raw.strip_prefix("refs/remotes/") {
        let (remote, branch) = value
            .split_once('/')
            .filter(|(remote, branch)| !remote.is_empty() && !branch.is_empty())
            .ok_or_else(|| HelperError(format!("invalid qualified ref {raw}")))?;
        (Some(format!("remote:{remote}")), branch.to_string())
    } else if let Some(value) = raw.strip_prefix("origin/") {
        if value.is_empty() {
            return Err(HelperError(format!("invalid qualified ref {raw}")));
        }
        (Some("origin".into()), value.to_string())
    } else {
        (None, raw.to_string())
    };
    validate_branch_text(&branch)?;
    Ok(branch_selector(raw, &branch, qualified))
}

fn parse_positive_number(value: &str) -> Option<u64> {
    value.parse::<u64>().ok().filter(|number| *number > 0)
}

fn pr_selector(raw: &str, number: u64) -> SourceSelector {
    SourceSelector {
        kind: "pull-request".into(),
        raw: raw.into(),
        canonical: format!("pr:{number}"),
        repository: None,
        number: Some(number),
        branch: None,
        query: None,
        fragment: None,
        provenance: vec![raw.into()],
    }
}

fn branch_selector(raw: &str, branch: &str, qualified: Option<String>) -> SourceSelector {
    let canonical = qualified
        .as_deref()
        .map(|prefix| format!("branch:{prefix}:{branch}"))
        .unwrap_or_else(|| format!("branch:{branch}"));
    SourceSelector {
        kind: "branch".into(),
        raw: raw.into(),
        canonical,
        repository: None,
        number: None,
        branch: Some(branch.into()),
        query: qualified,
        fragment: None,
        provenance: vec![raw.into()],
    }
}

fn parse_url_selector(raw: &str) -> Result<SourceSelector> {
    let (without_fragment, fragment) = raw
        .split_once('#')
        .map_or((raw, None), |(left, right)| (left, Some(right)));
    let (base, query) = without_fragment
        .split_once('?')
        .map_or((without_fragment, None), |(left, right)| {
            (left, Some(right.to_string()))
        });
    let after_scheme = base
        .strip_prefix("https://")
        .or_else(|| base.strip_prefix("http://"))
        .ok_or_else(|| HelperError("source URL must use http or https".into()))?;
    let (host, path) = after_scheme
        .split_once('/')
        .ok_or_else(|| HelperError("source URL needs a repository path".into()))?;
    if host != "github.com" {
        return Err(HelperError(format!("unsupported source host {host}")));
    }
    let mut parts = path.trim_matches('/').split('/');
    let owner = parts.next().filter(|value| !value.is_empty());
    let repo = parts.next().filter(|value| !value.is_empty());
    let (owner, mut repo) = match (owner, repo) {
        (Some(owner), Some(repo)) => (owner, repo.to_string()),
        _ => return Err(HelperError("source URL needs owner/repository".into())),
    };
    if repo.ends_with(".git") {
        repo.truncate(repo.len() - 4);
    }
    let repository = format!("{owner}/{repo}").to_ascii_lowercase();
    let tail = parts.collect::<Vec<_>>();
    if tail.len() == 2 && tail[0] == "pull" {
        let number = parse_positive_number(tail[1])
            .ok_or_else(|| HelperError("pull URL needs a positive number".into()))?;
        return Ok(SourceSelector {
            kind: "pull-request-url".into(),
            raw: raw.into(),
            canonical: format!("pr-url:{repository}#{number}"),
            repository: Some(repository),
            number: Some(number),
            branch: None,
            query,
            fragment: fragment.map(str::to_owned),
            provenance: vec![raw.into()],
        });
    }
    if tail.len() == 1 && tail[0] == "pulls" {
        return Ok(SourceSelector {
            kind: "pulls-url".into(),
            raw: raw.into(),
            canonical: format!(
                "pulls-url:{repository}?{}",
                query.clone().unwrap_or_default()
            ),
            repository: Some(repository),
            number: None,
            branch: None,
            query,
            fragment: fragment.map(str::to_owned),
            provenance: vec![raw.into()],
        });
    }
    if tail.len() == 2 && tail[0] == "branches" && tail[1] == "all" {
        return Ok(SourceSelector {
            kind: "branches-all-url".into(),
            raw: raw.into(),
            canonical: format!(
                "branches-all-url:{repository}?{}",
                query.clone().unwrap_or_default()
            ),
            repository: Some(repository),
            number: None,
            branch: None,
            query,
            fragment: fragment.map(str::to_owned),
            provenance: vec![raw.into()],
        });
    }
    Err(HelperError(
        "unsupported GitHub source URL; use /pull/N, /pulls, or /branches/all".into(),
    ))
}

fn bind_url_repositories(request: &mut Request) -> Result<()> {
    let mut found = request.repository.clone();
    for source in &request.sources {
        if let Some(repository) = &source.repository {
            if let Some(existing) = &found {
                if existing != repository {
                    return Err(HelperError(format!(
                        "mixed-repository batch: {existing} and {repository}"
                    )));
                }
            } else {
                found = Some(repository.clone());
            }
        }
    }
    request.repository = found;
    if let Some(repository) = request.repository.clone() {
        for source in &mut request.sources {
            if matches!(source.kind.as_str(), "pull-request" | "pull-request-url") {
                if let Some(number) = source.number {
                    source.repository = Some(repository.clone());
                    source.canonical = format!("pr:{repository}#{number}");
                }
            }
        }
    }
    Ok(())
}

fn resolve_selectors(repo_path: &Path, request: &Request) -> Result<ResolutionSet> {
    if request.schema != REQUEST_SCHEMA {
        return Err(HelperError("unsupported request schema".into()));
    }
    if request.all_work {
        return Err(HelperError(
            "--all-work requires host-wide discovery; use the convergence owner".into(),
        ));
    }
    let repo_path = fs::canonicalize(repo_path)
        .map_err(|_| HelperError("repository path is missing or not accessible".into()))?;
    let origin_url = git_output_optional(&repo_path, &["remote", "get-url", "origin"])
        .ok()
        .map(|value| value.trim().to_owned());
    let origin = origin_url.as_deref().and_then(canonical_github_repository);
    let repository = if let Some(expected) = &request.repository {
        match origin.as_deref() {
            Some(actual) if actual == expected => expected.clone(),
            Some(actual) => {
                return Err(HelperError(format!(
                    "repository binding mismatch: request={expected} origin={actual}"
                )))
            }
            None => {
                return Err(HelperError(format!(
                    "repository binding cannot verify {expected} against origin"
                )))
            }
        }
    } else {
        origin.unwrap_or_else(|| {
            origin_url
                .map(|value| redact_url(&value))
                .unwrap_or_else(|| format!("local:{}", repo_path.to_string_lossy()))
        })
    };

    let mut resolved = BTreeMap::<String, SourceResolution>::new();
    for selector in &request.sources {
        let items = match selector.kind.as_str() {
            "branch" => vec![resolve_branch_selector(&repo_path, selector, &repository)?],
            "pull-request" | "pull-request-url" => {
                vec![resolve_pull_request(&repository, selector)?]
            }
            "pulls-url" => resolve_pull_list(&repository, selector)?,
            "branches-all-url" => {
                resolve_branch_list(&repository, selector, &request.target_branch)?
            }
            kind => return Err(HelperError(format!("unsupported selector kind {kind}"))),
        };
        for item in items {
            if item.kind == "branch"
                && item
                    .head_branch
                    .as_deref()
                    .is_some_and(|branch| branch == request.target_branch)
            {
                continue;
            }
            if let Some(existing) = resolved.get_mut(&item.canonical) {
                for provenance in item.provenance {
                    if !existing.provenance.contains(&provenance) {
                        existing.provenance.push(provenance.clone());
                    }
                    if !existing.selector.provenance.contains(&provenance) {
                        existing.selector.provenance.push(provenance);
                    }
                }
            } else {
                resolved.insert(item.canonical.clone(), item);
            }
        }
    }
    Ok(ResolutionSet {
        schema: RESOLUTION_SCHEMA.into(),
        repository,
        resolved_at_unix: now_unix(),
        sources: resolved.into_values().collect(),
    })
}

fn resolve_branch_selector(
    repo_path: &Path,
    selector: &SourceSelector,
    repository: &str,
) -> Result<SourceResolution> {
    let branch = selector
        .branch
        .as_deref()
        .ok_or_else(|| HelperError("branch selector has no branch name".into()))?;
    let candidates = branch_candidates(repo_path, selector)?;
    if candidates.is_empty() {
        return Err(HelperError(format!(
            "source branch {branch} does not exist in the bound repository"
        )));
    }
    let unique_oids = candidates
        .iter()
        .map(|(_, oid)| oid.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    if unique_oids.len() > 1 {
        return Err(HelperError(format!(
            "ambiguous source branch {branch}: refs={}",
            candidates
                .iter()
                .map(|(reference, oid)| format!("{reference}@{oid}"))
                .collect::<Vec<_>>()
                .join(",")
        )));
    }
    let (source_ref, head_oid) = candidates
        .iter()
        .find(|(reference, _)| reference == &format!("refs/heads/{branch}"))
        .or_else(|| {
            candidates
                .iter()
                .find(|(reference, _)| reference == &format!("refs/remotes/origin/{branch}"))
        })
        .unwrap_or(&candidates[0]);
    Ok(SourceResolution {
        schema: RESOLUTION_SCHEMA.into(),
        selector: selector.clone(),
        repository: repository.into(),
        canonical: selector.canonical.clone(),
        kind: "branch".into(),
        source_ref: Some(source_ref.clone()),
        head_branch: Some(branch.into()),
        head_oid: Some(head_oid.clone()),
        base_branch: None,
        base_oid: None,
        number: None,
        state: None,
        draft: None,
        protected: None,
        provenance: selector.provenance.clone(),
    })
}

fn branch_candidates(repo_path: &Path, selector: &SourceSelector) -> Result<Vec<(String, String)>> {
    let branch = selector
        .branch
        .as_deref()
        .ok_or_else(|| HelperError("branch selector has no branch name".into()))?;
    let output = git_output(
        repo_path,
        &[
            "for-each-ref",
            "--format=%(refname) %(objectname)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let expected_prefix = match selector.query.as_deref() {
        Some("full-ref") => Some(format!("refs/heads/{branch}")),
        Some("origin") => Some(format!("refs/remotes/origin/{branch}")),
        Some(value) if value.starts_with("remote:") => Some(format!(
            "refs/remotes/{}/{branch}",
            &value["remote:".len()..]
        )),
        _ => None,
    };
    let mut candidates = output
        .lines()
        .filter_map(|line| {
            let (reference, oid) = line.split_once(' ')?;
            let matches = if let Some(expected) = &expected_prefix {
                reference == expected
            } else {
                reference == format!("refs/heads/{branch}")
                    || (reference.starts_with("refs/remotes/")
                        && reference.ends_with(&format!("/{branch}")))
            };
            matches.then(|| (reference.to_string(), oid.to_string()))
        })
        .collect::<Vec<_>>();
    candidates.sort();
    Ok(candidates)
}

fn resolve_pull_request(repository: &str, selector: &SourceSelector) -> Result<SourceResolution> {
    let number = selector
        .number
        .ok_or_else(|| HelperError("pull request selector has no number".into()))?;
    let value = github_api_json(&format!("repos/{repository}/pulls/{number}"), false)?;
    source_resolution_from_pull(selector, repository, &value)
}

fn resolve_pull_list(repository: &str, selector: &SourceSelector) -> Result<Vec<SourceResolution>> {
    let query = list_query(
        selector.query.as_deref(),
        &["state", "sort", "direction", "page", "per_page"],
    )?;
    let state = query.get("state").map(String::as_str).unwrap_or("open");
    if !matches!(state, "open" | "closed" | "all") {
        return Err(HelperError(format!(
            "unsupported pull request state {state}"
        )));
    }
    let mut endpoint = format!("repos/{repository}/pulls?state={state}&per_page=100");
    for key in ["sort", "direction"] {
        if let Some(value) = query.get(key) {
            endpoint.push('&');
            endpoint.push_str(key);
            endpoint.push('=');
            endpoint.push_str(value);
        }
    }
    let value = github_api_json(&endpoint, true)?;
    flatten_api_items(value)
        .into_iter()
        .map(|item| {
            let number = item
                .get("number")
                .and_then(serde_json::Value::as_u64)
                .ok_or_else(|| HelperError("pull list item has no number".into()))?;
            let mut item_selector = pr_selector(&format!("pr:{number}"), number);
            item_selector.repository = Some(repository.into());
            item_selector.provenance = selector.provenance.clone();
            source_resolution_from_pull(&item_selector, repository, &item)
        })
        .collect()
}

fn resolve_branch_list(
    repository: &str,
    selector: &SourceSelector,
    target_branch: &str,
) -> Result<Vec<SourceResolution>> {
    let query = list_query(
        selector.query.as_deref(),
        &["protected", "page", "per_page"],
    )?;
    let mut endpoint = format!("repos/{repository}/branches?per_page=100");
    if let Some(protected) = query.get("protected") {
        if !matches!(protected.as_str(), "true" | "false") {
            return Err(HelperError(
                "branches/all protected must be true or false".into(),
            ));
        }
        endpoint.push_str("&protected=");
        endpoint.push_str(protected);
    }
    let value = github_api_json(&endpoint, true)?;
    let mut output = Vec::new();
    for item in flatten_api_items(value) {
        let branch = item
            .get("name")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| HelperError("branch list item has no name".into()))?;
        validate_branch_text(branch)?;
        if branch == target_branch {
            continue;
        }
        let oid = item
            .get("commit")
            .and_then(serde_json::Value::as_object)
            .and_then(|commit| commit.get("sha"))
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| HelperError(format!("branch list item {branch} has no commit")))?;
        let protected = item.get("protected").and_then(serde_json::Value::as_bool);
        let item_selector = branch_selector(&format!("branch:{branch}"), branch, None);
        output.push(SourceResolution {
            schema: RESOLUTION_SCHEMA.into(),
            selector: SourceSelector {
                provenance: selector.provenance.clone(),
                ..item_selector
            },
            repository: repository.into(),
            canonical: format!("branch:{branch}"),
            kind: "branch".into(),
            source_ref: Some(format!("refs/heads/{branch}")),
            head_branch: Some(branch.into()),
            head_oid: Some(oid.into()),
            base_branch: None,
            base_oid: None,
            number: None,
            state: None,
            draft: None,
            protected,
            provenance: selector.provenance.clone(),
        });
    }
    output.sort_by(|left, right| left.canonical.cmp(&right.canonical));
    Ok(output)
}

fn source_resolution_from_pull(
    selector: &SourceSelector,
    repository: &str,
    value: &serde_json::Value,
) -> Result<SourceResolution> {
    let number = value
        .get("number")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| HelperError("pull request response has no number".into()))?;
    let base_repository = value
        .get("base")
        .and_then(serde_json::Value::as_object)
        .and_then(|base| base.get("repo"))
        .and_then(serde_json::Value::as_object)
        .and_then(|repo| repo.get("full_name"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_ascii_lowercase);
    if base_repository.as_deref() != Some(repository) {
        return Err(HelperError(format!(
            "pull request {number} is not based on repository {repository}"
        )));
    }
    let head = value
        .get("head")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| HelperError(format!("pull request {number} has no head")))?;
    let base = value
        .get("base")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| HelperError(format!("pull request {number} has no base")))?;
    let head_oid = head
        .get("sha")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| HelperError(format!("pull request {number} has no head SHA")))?;
    let head_branch = head
        .get("ref")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| HelperError(format!("pull request {number} has no head branch")))?;
    let base_branch = base
        .get("ref")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| HelperError(format!("pull request {number} has no base branch")))?;
    let base_oid = base.get("sha").and_then(serde_json::Value::as_str);
    let mut item_selector = selector.clone();
    item_selector.repository = Some(repository.into());
    item_selector.number = Some(number);
    item_selector.canonical = format!("pr:{repository}#{number}");
    Ok(SourceResolution {
        schema: RESOLUTION_SCHEMA.into(),
        selector: item_selector,
        repository: repository.into(),
        canonical: format!("pr:{repository}#{number}"),
        kind: "pull-request".into(),
        source_ref: Some(format!("refs/pull/{number}/head")),
        head_branch: Some(head_branch.into()),
        head_oid: Some(head_oid.into()),
        base_branch: Some(base_branch.into()),
        base_oid: base_oid.map(str::to_owned),
        number: Some(number),
        state: value
            .get("state")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        draft: value.get("draft").and_then(serde_json::Value::as_bool),
        protected: None,
        provenance: selector.provenance.clone(),
    })
}

fn list_query(query: Option<&str>, allowed: &[&str]) -> Result<BTreeMap<String, String>> {
    let mut values = BTreeMap::new();
    for pair in query
        .unwrap_or_default()
        .split('&')
        .filter(|pair| !pair.is_empty())
    {
        let (key, value) = pair
            .split_once('=')
            .ok_or_else(|| HelperError(format!("query parameter lacks value: {pair}")))?;
        if !allowed.contains(&key)
            || value.is_empty()
            || value
                .chars()
                .any(|character| matches!(character, ' ' | '\n' | '\r'))
        {
            return Err(HelperError(format!(
                "unsupported list query parameter {key}"
            )));
        }
        if values.insert(key.into(), value.into()).is_some() {
            return Err(HelperError(format!("duplicate list query parameter {key}")));
        }
    }
    Ok(values)
}

fn github_api_json(endpoint: &str, paginate: bool) -> Result<serde_json::Value> {
    let binary = env::var_os("TAILROCKS_GH_BIN").unwrap_or_else(|| OsString::from("gh"));
    let mut command = Command::new(binary);
    command.arg("api");
    if paginate {
        command.args(["--paginate", "--slurp"]);
    }
    let output = command
        .arg(endpoint)
        .output()
        .map_err(|_| HelperError("GitHub API client gh is unavailable".into()))?;
    if !output.status.success() {
        return Err(HelperError(format!(
            "GitHub API request failed for {endpoint}"
        )));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|_| HelperError(format!("GitHub API returned invalid JSON for {endpoint}")))
}

fn flatten_api_items(value: serde_json::Value) -> Vec<serde_json::Value> {
    match value {
        serde_json::Value::Array(items) => items.into_iter().flat_map(flatten_api_items).collect(),
        item => vec![item],
    }
}

fn normalize_repository(value: &str) -> Result<String> {
    if value.contains('/') && !value.starts_with("http://") && !value.starts_with("https://") {
        let mut parts = value.split('/');
        let owner = parts.next().unwrap_or_default();
        let repo = parts.next().unwrap_or_default().trim_end_matches(".git");
        if !owner.is_empty() && !repo.is_empty() && parts.next().is_none() {
            return Ok(format!("{owner}/{repo}").to_ascii_lowercase());
        }
    }
    let selector = parse_url_selector(&format!("{}/pull/1", value.trim_end_matches('/')))
        .map_err(|_| HelperError("--repo must be OWNER/REPO or a GitHub repository URL".into()))?;
    selector
        .repository
        .ok_or_else(|| HelperError("invalid repository identity".into()))
}

fn validate_cleanup(value: &str) -> Result<()> {
    if matches!(value, "resolved" | "none") {
        Ok(())
    } else {
        Err(HelperError("--cleanup must be resolved or none".into()))
    }
}

fn validate_branch_text(value: &str) -> Result<()> {
    if value.is_empty()
        || value.starts_with('-')
        || value.chars().any(char::is_whitespace)
        || value.contains("..")
        || value.contains("@{")
        || value
            .chars()
            .any(|character| matches!(character, '~' | '^' | ':' | '?' | '*' | '[' | '\\' | '\0'))
    {
        return Err(HelperError(format!("invalid branch/ref selector {value}")));
    }
    Ok(())
}

fn check_target(repo_path: &Path, branch: &str, remote: Option<&str>) -> Result<TargetReceipt> {
    validate_branch_text(branch)?;
    let repo_path = fs::canonicalize(repo_path)
        .map_err(|_| HelperError("repository path is missing or not accessible".into()))?;
    let _ = git_output(&repo_path, &["rev-parse", "--git-dir"])?;
    let target_ref = format!("refs/heads/{branch}");
    let target_oid = if let Some(remote) = remote {
        let output = git_output_optional(
            &repo_path,
            &["ls-remote", "--exit-code", "--heads", remote, &target_ref],
        )
        .map_err(|_| missing_target(&repo_path, branch, Some(remote)))?;
        output
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().next())
            .ok_or_else(|| HelperError("remote target response lacked an object id".into()))?
            .to_string()
    } else {
        git_output_optional(&repo_path, &["show-ref", "--verify", &target_ref])
            .map_err(|_| missing_target(&repo_path, branch, None))?
            .split_whitespace()
            .next()
            .ok_or_else(|| missing_target(&repo_path, branch, None))?
            .to_string()
    };
    let advertised_default_branch = git_output_optional(
        &repo_path,
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
    )
    .ok()
    .map(|value| value.trim_start_matches("origin/").trim().to_string())
    .filter(|value| !value.is_empty());
    Ok(TargetReceipt {
        schema: TARGET_SCHEMA.into(),
        repo_path: repo_path.to_string_lossy().into_owned(),
        target_branch: branch.into(),
        target_ref,
        target_oid,
        remote: remote.map(str::to_owned),
        advertised_default_branch,
        checked_at_unix: now_unix(),
    })
}

fn missing_target(repo_path: &Path, branch: &str, remote: Option<&str>) -> HelperError {
    let candidate_text = git_output_optional(
        repo_path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
    )
    .unwrap_or_default();
    let candidates = candidate_text
        .lines()
        .filter(|candidate| !candidate.is_empty())
        .take(20)
        .collect::<Vec<_>>();
    let scope = remote.map_or_else(|| "local".into(), |value| format!("remote {value}"));
    HelperError(format!(
        "target {branch} does not exist in {scope}; candidates={}",
        candidates.join(",")
    ))
}

fn init_campaign(
    state_dir: &Path,
    repo_path: &Path,
    request: Request,
    target: TargetReceipt,
    resolution: Option<ResolutionSet>,
) -> Result<CampaignState> {
    if request.schema != REQUEST_SCHEMA || target.schema != TARGET_SCHEMA {
        return Err(HelperError(
            "unsupported request or target receipt schema".into(),
        ));
    }
    if request.target_branch != target.target_branch {
        return Err(HelperError(
            "request and target receipt select different branches".into(),
        ));
    }
    let repo_path = fs::canonicalize(repo_path)
        .map_err(|_| HelperError("repository path is missing or not accessible".into()))?;
    let state_dir = state_dir.to_path_buf();
    fs::create_dir_all(&state_dir)
        .map_err(|_| HelperError("cannot create state directory".into()))?;
    let state_dir = fs::canonicalize(&state_dir)
        .map_err(|_| HelperError("cannot resolve state directory".into()))?;
    if state_dir.starts_with(&repo_path) {
        return Err(HelperError(
            "campaign state must live outside the repository".into(),
        ));
    }
    let origin_url = git_output_optional(&repo_path, &["remote", "get-url", "origin"])
        .ok()
        .map(|value| value.trim().to_owned());
    let origin_repository = origin_url.as_deref().and_then(canonical_github_repository);
    let repository = if let Some(expected) = request.repository.clone() {
        match origin_repository.as_deref() {
            Some(actual) if actual != expected => {
                return Err(HelperError(format!(
                    "repository binding mismatch: request={expected} origin={actual}"
                )));
            }
            None => {
                return Err(HelperError(format!(
                    "repository binding cannot verify {expected} against origin"
                )));
            }
            _ => {}
        }
        expected
    } else {
        origin_url
            .map(|value| redact_url(&value))
            .unwrap_or_else(|| format!("local:{}", repo_path.to_string_lossy()))
    };
    let (resolved_sources, source_resolution_at_unix) = if let Some(resolution) = resolution {
        if resolution.schema != RESOLUTION_SCHEMA || resolution.repository != repository {
            return Err(HelperError(
                "source resolution does not bind to the campaign repository".into(),
            ));
        }
        if resolution.sources.iter().any(|source| {
            !request.sources.iter().any(|selector| {
                selector
                    .provenance
                    .iter()
                    .any(|provenance| source.provenance.contains(provenance))
            }) || (source.kind == "branch"
                && source.head_branch.as_deref() == Some(request.target_branch.as_str()))
        }) {
            return Err(HelperError(
                "source resolution contains an unrequested or target branch".into(),
            ));
        }
        (resolution.sources, Some(resolution.resolved_at_unix))
    } else {
        (Vec::new(), None)
    };
    let source_resolution_digest = if source_resolution_at_unix.is_none() {
        String::new()
    } else {
        sha256_bytes(
            serde_json::to_vec(&resolved_sources)
                .map_err(|_| HelperError("source resolution encode failed".into()))?
                .as_slice(),
        )
    };
    let seed = format!(
        "{}\n{}\n{}\n{}\n{}",
        repository,
        request.target_branch,
        request.raw_text,
        target.target_oid,
        source_resolution_digest
    );
    let campaign_id = format!("campaign-{}", &sha256_bytes(seed.as_bytes())[..16]);
    let path = state_dir.join(format!("{campaign_id}.json"));
    if path.exists() {
        let existing: CampaignState = read_json(&path)?;
        if existing.repository != repository
            || existing.repo_path != repo_path.to_string_lossy().as_ref()
            || existing.request != request
            || existing.source_resolution_digest != source_resolution_digest
            || !same_target_identity(&existing.target, &target)
        {
            return Err(HelperError(format!(
                "campaign identity collision: {campaign_id} belongs to another repository, target, or request"
            )));
        }
        if existing.status != "complete" {
            ensure_campaign_lease(&existing)?;
            ensure_target_lease(&existing)?;
        }
        return Ok(existing);
    }
    let scope = if request.all_work {
        "all-work"
    } else {
        "selected-sources"
    };
    let configuration_digest = sha256_bytes(
        format!(
            "{}\n{}\n{}\n{}\n{}",
            request.raw_text,
            request.target_branch,
            request.audit_only,
            request.local_only,
            request.cleanup
        )
        .as_bytes(),
    );
    let lock_path = state_dir.join(format!("{campaign_id}.lock"));
    let target_lock_path = state_dir.join(format!(
        "target-{}.lock",
        &sha256_bytes(format!("{}\n{}", repository, target.target_ref).as_bytes())[..16]
    ));
    let lease = CampaignLease {
        schema: LEASE_SCHEMA.into(),
        campaign_id: campaign_id.clone(),
        repository: repository.clone(),
        repo_path: repo_path.to_string_lossy().into_owned(),
        target_branch: target.target_branch.clone(),
        target_ref: target.target_ref.clone(),
        target_oid: target.target_oid.clone(),
        owner_pid: std::process::id(),
        acquired_at_unix: now_unix(),
    };
    let initial_target_oid = target.target_oid.clone();
    let audit_only = request.audit_only;
    let local_only = request.local_only;
    let target_lease = TargetLease {
        schema: TARGET_LEASE_SCHEMA.into(),
        campaign_id: campaign_id.clone(),
        repository: repository.clone(),
        repo_path: repo_path.to_string_lossy().into_owned(),
        target_branch: target.target_branch.clone(),
        target_ref: target.target_ref.clone(),
        target_oid: target.target_oid.clone(),
        owner_pid: std::process::id(),
        acquired_at_unix: now_unix(),
    };
    create_target_lease(&target_lock_path, &target_lease)?;
    if let Err(error) = create_campaign_lease(&lock_path, &lease) {
        let _ = fs::remove_file(&target_lock_path);
        return Err(error);
    }
    let state = CampaignState {
        schema: CAMPAIGN_SCHEMA.into(),
        campaign_id,
        created_at_unix: now_unix(),
        repository,
        repo_path: repo_path.to_string_lossy().into_owned(),
        target,
        frozen_sources: request.sources.clone(),
        resolved_sources,
        source_resolution_at_unix,
        request,
        scope: scope.into(),
        initial_target_oid: initial_target_oid.clone(),
        current_target_oid: initial_target_oid,
        audit_only,
        local_only,
        configuration_digest,
        source_resolution_digest,
        scan_coverage: vec!["target-ref".into(), "source-selectors".into()],
        decisions: Vec::new(),
        receipt_refs: Vec::new(),
        recovery_index: Vec::new(),
        lock_path: lock_path.to_string_lossy().into_owned(),
        target_lock_path: target_lock_path.to_string_lossy().into_owned(),
        status: "planned".into(),
        phase: "bound".into(),
        journal: vec![JournalEntry {
            sequence: 1,
            event: "campaign-bound".into(),
            phase: "bound".into(),
            status: "planned".into(),
            at_unix: now_unix(),
        }],
    };
    if let Err(error) = write_json_atomic(&path, &state) {
        let _ = fs::remove_file(&lock_path);
        let _ = fs::remove_file(&target_lock_path);
        return Err(error);
    }
    Ok(state)
}

fn same_target_identity(left: &TargetReceipt, right: &TargetReceipt) -> bool {
    left.repo_path == right.repo_path
        && left.target_branch == right.target_branch
        && left.target_ref == right.target_ref
        && left.target_oid == right.target_oid
        && left.remote == right.remote
}

fn receipt_matches_campaign(value: &serde_json::Value, state: &CampaignState) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let target = object.get("target").and_then(serde_json::Value::as_object);
    let target_branch = target
        .and_then(|value| value.get("branch"))
        .or_else(|| object.get("target_branch"))
        .and_then(serde_json::Value::as_str);
    let target_ref = target
        .and_then(|value| value.get("ref"))
        .or_else(|| object.get("target_ref"))
        .and_then(serde_json::Value::as_str);
    let target_oid = target
        .and_then(|value| value.get("oid"))
        .or_else(|| object.get("target_oid"))
        .and_then(serde_json::Value::as_str);
    let repo_path = target
        .and_then(|value| value.get("repo_path"))
        .or_else(|| object.get("repo_path"))
        .and_then(serde_json::Value::as_str);
    let source_ids = object
        .get("source_ids")
        .and_then(serde_json::Value::as_array);
    let source_ids_valid = source_ids.is_some_and(|ids| {
        let values = ids
            .iter()
            .filter_map(serde_json::Value::as_str)
            .collect::<Vec<_>>();
        values.len() == ids.len()
            && (state.scope == "all-work"
                || (!values.is_empty()
                    && values.iter().all(|id| {
                        state
                            .frozen_sources
                            .iter()
                            .any(|source| source.canonical == *id)
                    })))
    });
    let phase = object.get("phase").and_then(serde_json::Value::as_str);
    let status = object.get("status").and_then(serde_json::Value::as_str);
    let operation_id = object
        .get("operation_id")
        .and_then(serde_json::Value::as_str);
    let content_hash = object
        .get("content_sha256")
        .or_else(|| object.get("artifact_sha256"))
        .and_then(serde_json::Value::as_str);
    object.get("schema").and_then(serde_json::Value::as_str) == Some(RECEIPT_SCHEMA)
        && object
            .get("campaign_id")
            .and_then(serde_json::Value::as_str)
            == Some(state.campaign_id.as_str())
        && object.get("scope").and_then(serde_json::Value::as_str) == Some(state.scope.as_str())
        && object.get("repository").and_then(serde_json::Value::as_str)
            == Some(state.repository.as_str())
        && repo_path == Some(state.repo_path.as_str())
        && target_ref == Some(state.target.target_ref.as_str())
        && target_oid.is_some_and(|oid| {
            oid == state.initial_target_oid.as_str() || oid == state.current_target_oid.as_str()
        })
        && target_branch.is_none_or(|branch| branch == state.target.target_branch)
        && source_ids_valid
        && matches!(
            phase,
            Some(
                "audit"
                    | "review"
                    | "ci"
                    | "landing"
                    | "verification"
                    | "cleanup"
                    | "idempotency"
                    | "recovery"
            )
        )
        && status.is_some_and(|value| !value.is_empty() && value != "pending" && value != "queued")
        && operation_id.is_some_and(|value| !value.is_empty())
        && content_hash.is_some_and(is_sha256)
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|character| character.is_ascii_hexdigit())
}

fn receipts_support_completion(state: &CampaignState) -> bool {
    let required = if state.audit_only {
        vec!["audit"]
    } else {
        let mut phases = vec!["audit", "review", "ci", "landing", "verification"];
        if state.request.cleanup == "resolved" {
            phases.push("cleanup");
        }
        phases
    };
    let mut phases = BTreeMap::<String, ()>::new();
    for path in &state.receipt_refs {
        let Ok(value) = read_json::<serde_json::Value>(Path::new(path)) else {
            return false;
        };
        if !receipt_matches_campaign(&value, state) {
            return false;
        }
        if let Some(phase) = value.get("phase").and_then(serde_json::Value::as_str) {
            phases.insert(phase.to_owned(), ());
        }
    }
    required.into_iter().all(|phase| phases.contains_key(phase))
}

fn create_campaign_lease(path: &Path, lease: &CampaignLease) -> Result<()> {
    let bytes =
        serde_json::to_vec_pretty(lease).map_err(|_| HelperError("lease encode failed".into()))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| HelperError("campaign lease already exists or cannot be created".into()))?;
    file.write_all(&bytes)
        .map_err(|_| HelperError("cannot write campaign lease".into()))?;
    file.write_all(b"\n")
        .map_err(|_| HelperError("cannot finish campaign lease".into()))?;
    file.sync_all()
        .map_err(|_| HelperError("cannot sync campaign lease".into()))
}

fn create_target_lease(path: &Path, lease: &TargetLease) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(lease)
        .map_err(|_| HelperError("target lease encode failed".into()))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| HelperError("target already has an active campaign lease".into()))?;
    file.write_all(&bytes)
        .map_err(|_| HelperError("cannot write target lease".into()))?;
    file.write_all(b"\n")
        .map_err(|_| HelperError("cannot finish target lease".into()))?;
    file.sync_all()
        .map_err(|_| HelperError("cannot sync target lease".into()))
}

fn acquire_state_mutation_lock(state_path: &Path) -> Result<StateMutationLock> {
    let lock_path = state_path.with_extension("state.lock");
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|_| HelperError("cannot open campaign state mutation lock".into()))?;
    file.try_lock_exclusive().map_err(|_| {
        HelperError(
            "campaign state mutation already in progress; retry after the active writer exits"
                .into(),
        )
    })?;
    Ok(StateMutationLock { file })
}

fn ensure_campaign_lease(state: &CampaignState) -> Result<()> {
    let lease: CampaignLease = read_json(Path::new(&state.lock_path))?;
    if lease.schema != LEASE_SCHEMA
        || lease.campaign_id != state.campaign_id
        || lease.repository != state.repository
        || lease.repo_path != state.repo_path
        || lease.target_branch != state.target.target_branch
        || lease.target_ref != state.target.target_ref
        || lease.target_oid != state.initial_target_oid
    {
        return Err(HelperError(
            "campaign lease identity does not match campaign state".into(),
        ));
    }
    ensure_target_lease(state)?;
    Ok(())
}

fn target_lock_path(state: &CampaignState) -> PathBuf {
    if !state.target_lock_path.is_empty() {
        return PathBuf::from(&state.target_lock_path);
    }
    let parent = Path::new(&state.lock_path)
        .parent()
        .unwrap_or_else(|| Path::new("."));
    parent.join(format!(
        "target-{}.lock",
        &sha256_bytes(format!("{}\n{}", state.repository, state.target.target_ref).as_bytes())
            [..16]
    ))
}

fn ensure_target_lease(state: &CampaignState) -> Result<()> {
    let path = target_lock_path(state);
    if !path.exists() {
        let lease = TargetLease {
            schema: TARGET_LEASE_SCHEMA.into(),
            campaign_id: state.campaign_id.clone(),
            repository: state.repository.clone(),
            repo_path: state.repo_path.clone(),
            target_branch: state.target.target_branch.clone(),
            target_ref: state.target.target_ref.clone(),
            target_oid: state.initial_target_oid.clone(),
            owner_pid: std::process::id(),
            acquired_at_unix: now_unix(),
        };
        create_target_lease(&path, &lease)?;
    }
    let lease: TargetLease = read_json(&path)?;
    if lease.schema != TARGET_LEASE_SCHEMA
        || lease.campaign_id != state.campaign_id
        || lease.repository != state.repository
        || lease.repo_path != state.repo_path
        || lease.target_branch != state.target.target_branch
        || lease.target_ref != state.target.target_ref
        || lease.target_oid != state.initial_target_oid
    {
        return Err(HelperError(
            "target lease identity does not match campaign state".into(),
        ));
    }
    Ok(())
}

fn release_campaign_lease(state: &CampaignState) -> Result<()> {
    let path = Path::new(&state.lock_path);
    if !path.exists() {
        return Ok(());
    }
    ensure_campaign_lease(state)?;
    fs::remove_file(path).map_err(|_| HelperError("cannot release campaign lease".into()))?;
    let target_path = target_lock_path(state);
    if target_path.exists() {
        let target_lease: TargetLease = read_json(&target_path)?;
        if target_lease.campaign_id != state.campaign_id {
            return Err(HelperError(
                "target lease belongs to another campaign".into(),
            ));
        }
        fs::remove_file(target_path)
            .map_err(|_| HelperError("cannot release target lease".into()))?;
    }
    Ok(())
}

fn observe_campaign(
    state_path: &Path,
    state: &mut CampaignState,
    target: TargetReceipt,
) -> Result<()> {
    ensure_campaign_lease(state)?;
    if target.schema != TARGET_SCHEMA
        || target.repo_path != state.repo_path
        || target.target_branch != state.target.target_branch
        || target.target_ref != state.target.target_ref
        || target.remote != state.target.remote
    {
        return Err(HelperError(
            "observed target identity conflicts with campaign".into(),
        ));
    }
    if target.target_oid != state.current_target_oid {
        let actual_oid = git_output_optional(
            Path::new(&state.repo_path),
            &["rev-parse", &state.target.target_ref],
        )
        .map_err(|_| HelperError("cannot re-read the campaign target ref".into()))?
        .trim()
        .to_owned();
        if actual_oid != target.target_oid {
            return Err(HelperError(
                "observed target receipt is stale relative to the current target ref".into(),
            ));
        }
        if !is_ancestor(
            Path::new(&state.repo_path),
            &state.current_target_oid,
            &target.target_oid,
        )? {
            return Err(HelperError(
                "target moved non-fast-forward; re-audit before continuing".into(),
            ));
        }
    }
    state.current_target_oid = target.target_oid.clone();
    state.journal.push(JournalEntry {
        sequence: state.journal.len() as u64 + 1,
        event: "target-observed".into(),
        phase: "observed".into(),
        status: "recorded".into(),
        at_unix: now_unix(),
    });
    state.phase = "observed".into();
    write_json_atomic(state_path, state)
}

fn create_snapshot(repo_path: &Path, output: &Path) -> Result<SnapshotManifest> {
    if output.exists() {
        return Err(HelperError("snapshot output already exists".into()));
    }
    let repo_path = fs::canonicalize(repo_path)
        .map_err(|_| HelperError("repository path is missing or not accessible".into()))?;
    let head_oid = git_output(&repo_path, &["rev-parse", "HEAD"])?
        .trim()
        .to_string();
    let head_ref = git_output_optional(&repo_path, &["symbolic-ref", "-q", "HEAD"])
        .ok()
        .map(|value| value.trim().to_string());
    fs::create_dir_all(output)
        .map_err(|_| HelperError("cannot create snapshot directory".into()))?;
    write_command_bytes(
        &repo_path,
        &["status", "--porcelain=v2", "-z", "--untracked-files=all"],
        &output.join("status.porcelain-v2"),
    )?;
    write_command_bytes(
        &repo_path,
        &["diff", "--binary"],
        &output.join("unstaged.patch"),
    )?;
    write_command_bytes(
        &repo_path,
        &["diff", "--cached", "--binary"],
        &output.join("staged.patch"),
    )?;
    let bundle = output.join("snapshot.bundle");
    let bundle_arg = bundle.to_string_lossy().to_string();
    git_run(&repo_path, &["bundle", "create", &bundle_arg, "--all"])?;
    let files = collect_extra_files(&repo_path, output)?;
    let manifest = SnapshotManifest {
        schema: SNAPSHOT_SCHEMA.into(),
        created_at_unix: now_unix(),
        repo_path: repo_path.to_string_lossy().into_owned(),
        head_oid,
        head_ref,
        files,
        staged_patch_sha256: sha256_file(&output.join("staged.patch"))?,
        unstaged_patch_sha256: sha256_file(&output.join("unstaged.patch"))?,
        status_sha256: sha256_file(&output.join("status.porcelain-v2"))?,
    };
    write_json_atomic(&output.join("snapshot.json"), &manifest)?;
    Ok(manifest)
}

fn restore_test(snapshot: &Path, output: &Path) -> Result<RestoreReceipt> {
    if output.exists() {
        return Err(HelperError("restore output already exists".into()));
    }
    let manifest: SnapshotManifest = read_json(&snapshot.join("snapshot.json"))?;
    if manifest.schema != SNAPSHOT_SCHEMA {
        return Err(HelperError("unsupported snapshot schema".into()));
    }
    let bundle = snapshot.join("snapshot.bundle");
    git_run(
        Path::new("."),
        &["bundle", "verify", &bundle.to_string_lossy()],
    )?;
    fs::create_dir_all(output)
        .map_err(|_| HelperError("cannot create restore directory".into()))?;
    let restored = output.join("repository");
    let bundle_arg = bundle.to_string_lossy().to_string();
    let restored_arg = restored.to_string_lossy().to_string();
    git_run(
        Path::new("."),
        &[
            "clone",
            "--quiet",
            "--no-checkout",
            &bundle_arg,
            &restored_arg,
        ],
    )?;
    git_run(
        &restored,
        &["checkout", "--quiet", "--detach", &manifest.head_oid],
    )?;
    let staged_patch = snapshot.join("staged.patch");
    let unstaged_patch = snapshot.join("unstaged.patch");
    for patch in [&staged_patch, &unstaged_patch] {
        if !patch.is_file() {
            return Err(HelperError(format!(
                "snapshot patch artifact is missing: {}",
                patch.display()
            )));
        }
    }
    let staged_patch_verified = apply_patch_if_nonempty(&restored, &staged_patch, true)?;
    let unstaged_patch_verified = apply_patch_if_nonempty(&restored, &unstaged_patch, false)?;
    let mut verified = 0usize;
    for file in &manifest.files {
        let source = snapshot.join("files").join(&file.path);
        let destination = restored.join(&file.path);
        restore_entry(&source, &destination, &file.kind)?;
        if sha256_path(&destination)? != file.sha256 {
            return Err(HelperError(format!(
                "restored file hash mismatch for {}",
                file.path
            )));
        }
        verified += 1;
    }
    if staged_patch_verified {
        let actual = sha256_bytes(&git_output_bytes(
            &restored,
            &["diff", "--cached", "--binary"],
        )?);
        if actual != manifest.staged_patch_sha256 {
            return Err(HelperError(
                "restored staged patch differs from snapshot".into(),
            ));
        }
    }
    if unstaged_patch_verified {
        let actual = sha256_bytes(&git_output_bytes(&restored, &["diff", "--binary"])?);
        if actual != manifest.unstaged_patch_sha256 {
            return Err(HelperError(
                "restored unstaged patch differs from snapshot".into(),
            ));
        }
    }
    let receipt = RestoreReceipt {
        schema: "tailrocks.snapshot-restore/v1".into(),
        snapshot_schema: manifest.schema,
        bundle_verified: true,
        head_verified: git_output(&restored, &["rev-parse", "HEAD"])?.trim() == manifest.head_oid,
        staged_patch_verified,
        unstaged_patch_verified,
        files_verified: verified,
        ignored_or_untracked_verified: verified,
        verified_at_unix: now_unix(),
    };
    write_json_atomic(&output.join("restore-receipt.json"), &receipt)?;
    Ok(receipt)
}

fn apply_patch_if_nonempty(repo: &Path, patch: &Path, index: bool) -> Result<bool> {
    if fs::metadata(patch)
        .map_err(|_| {
            HelperError(format!(
                "snapshot patch artifact is missing: {}",
                patch.display()
            ))
        })?
        .len()
        == 0
    {
        return Ok(false);
    }
    let patch_arg = patch.to_string_lossy().to_string();
    let args = if index {
        vec!["apply", "--index", &patch_arg]
    } else {
        vec!["apply", &patch_arg]
    };
    git_run(repo, &args)?;
    Ok(true)
}

fn collect_extra_files(repo: &Path, snapshot: &Path) -> Result<Vec<SnapshotFile>> {
    let mut relative_paths = BTreeMap::<String, ()>::new();
    for args in [
        &["ls-files", "-z", "--others", "--exclude-standard"][..],
        &[
            "ls-files",
            "-z",
            "--others",
            "--ignored",
            "--exclude-standard",
        ][..],
    ] {
        let paths = git_output_bytes(repo, args)?;
        for raw in paths
            .split(|byte| *byte == 0)
            .filter(|part| !part.is_empty())
        {
            let relative = String::from_utf8(raw.to_vec())
                .map_err(|_| HelperError("non-UTF-8 extra path cannot be snapshotted".into()))?;
            validate_relative_path(&relative)?;
            relative_paths.insert(relative, ());
        }
    }
    let mut files = Vec::new();
    for relative in relative_paths.keys() {
        let source = repo.join(relative);
        let destination = snapshot.join("files").join(relative);
        let kind = copy_entry(&source, &destination)?;
        files.push(SnapshotFile {
            path: relative.clone(),
            kind,
            sha256: sha256_path(&source)?,
            size: path_size(&source)?,
        });
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

fn validate_relative_path(value: &str) -> Result<()> {
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(HelperError("unsafe relative path in Git output".into()));
    }
    Ok(())
}

fn copy_entry(source: &Path, destination: &Path) -> Result<String> {
    let metadata =
        fs::symlink_metadata(source).map_err(|_| HelperError("cannot read source file".into()))?;
    if metadata.file_type().is_symlink() {
        let target =
            fs::read_link(source).map_err(|_| HelperError("cannot read symlink".into()))?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| HelperError("cannot create snapshot path".into()))?;
        }
        symlink(&target, destination)?;
        return Ok("symlink".into());
    }
    if metadata.is_dir() {
        return Err(HelperError(
            "Git returned a directory as an extra file".into(),
        ));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| HelperError("cannot create snapshot path".into()))?;
    }
    fs::copy(source, destination).map_err(|_| HelperError("cannot copy source file".into()))?;
    Ok("file".into())
}

fn restore_entry(source: &Path, destination: &Path, kind: &str) -> Result<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|_| HelperError("cannot create restore path".into()))?;
    }
    if kind == "symlink" {
        let target = fs::read_link(source)
            .map_err(|_| HelperError("cannot read snapshot symlink".into()))?;
        symlink(&target, destination)
    } else {
        fs::copy(source, destination)
            .map_err(|_| HelperError("cannot restore source file".into()))?;
        Ok(())
    }
}

#[cfg(unix)]
fn symlink(target: &Path, destination: &Path) -> Result<()> {
    std::os::unix::fs::symlink(target, destination)
        .map_err(|_| HelperError("cannot create symlink".into()))
}

#[cfg(not(unix))]
fn symlink(_target: &Path, _destination: &Path) -> Result<()> {
    Err(HelperError("symlink snapshot support requires Unix".into()))
}

fn write_command_bytes(repo: &Path, args: &[&str], output: &Path) -> Result<()> {
    let bytes = git_output_bytes(repo, args)?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| HelperError("cannot create output directory".into()))?;
    }
    fs::write(output, bytes).map_err(|_| HelperError("cannot write command output".into()))
}

fn git_output(repo: &Path, args: &[&str]) -> Result<String> {
    let bytes = git_output_bytes(repo, args)?;
    String::from_utf8(bytes).map_err(|_| HelperError("git returned non-UTF-8 output".into()))
}

fn git_output_optional(repo: &Path, args: &[&str]) -> Result<String> {
    let output = command(repo, args)?;
    if output.status.success() {
        String::from_utf8(output.stdout)
            .map_err(|_| HelperError("git returned non-UTF-8 output".into()))
    } else {
        Err(HelperError(format!(
            "git command failed: {}",
            args.first().unwrap_or(&"git")
        )))
    }
}

fn git_output_bytes(repo: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let output = command(repo, args)?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(HelperError(format!(
            "git command failed: {}",
            args.first().unwrap_or(&"git")
        )))
    }
}

fn git_run(repo: &Path, args: &[&str]) -> Result<()> {
    let output = command(repo, args)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(HelperError(format!(
            "git command failed: {}",
            args.first().unwrap_or(&"git")
        )))
    }
}

fn is_ancestor(repo: &Path, older: &str, newer: &str) -> Result<bool> {
    let output = command(repo, &["merge-base", "--is-ancestor", older, newer])?;
    if output.status.success() {
        Ok(true)
    } else if output.status.code() == Some(1) {
        Ok(false)
    } else {
        Err(HelperError("git could not compare target ancestry".into()))
    }
}

fn command(repo: &Path, args: &[&str]) -> Result<Output> {
    Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|_| HelperError("git executable is unavailable".into()))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let bytes = fs::read(path).map_err(|_| HelperError("cannot read JSON input".into()))?;
    serde_json::from_slice(&bytes).map_err(|_| HelperError("invalid JSON input".into()))
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| HelperError("JSON path has no parent".into()))?;
    fs::create_dir_all(parent).map_err(|_| HelperError("cannot create JSON parent".into()))?;
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|_| HelperError("json encode failed".into()))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|_| HelperError("cannot create atomic JSON temporary file".into()))?;
    file.write_all(&bytes)
        .map_err(|_| HelperError("cannot write JSON".into()))?;
    file.write_all(b"\n")
        .map_err(|_| HelperError("cannot finish JSON".into()))?;
    file.sync_all()
        .map_err(|_| HelperError("cannot sync JSON".into()))?;
    fs::rename(&temp, path).map_err(|_| HelperError("cannot publish atomic JSON".into()))
}

fn sha256_file(path: &Path) -> Result<String> {
    let bytes = fs::read(path).map_err(|_| HelperError("cannot hash file".into()))?;
    Ok(sha256_bytes(&bytes))
}

fn sha256_path(path: &Path) -> Result<String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| HelperError("cannot stat path".into()))?;
    if metadata.file_type().is_symlink() {
        let target = fs::read_link(path).map_err(|_| HelperError("cannot read symlink".into()))?;
        Ok(sha256_bytes(target.to_string_lossy().as_bytes()))
    } else {
        sha256_file(path)
    }
}

fn path_size(path: &Path) -> Result<u64> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| HelperError("cannot stat path".into()))?;
    if metadata.file_type().is_symlink() {
        Ok(fs::read_link(path)
            .map_err(|_| HelperError("cannot read symlink".into()))?
            .to_string_lossy()
            .len() as u64)
    } else {
        Ok(metadata.len())
    }
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn redact_url(value: &str) -> String {
    for scheme in ["https://", "http://", "ssh://"] {
        if let Some(start) = value.find(scheme) {
            if let Some(at) = value[start + scheme.len()..].find('@') {
                let absolute_at = start + scheme.len() + at;
                let host_start = absolute_at + 1;
                return format!(
                    "{}{}{}",
                    &value[..start + scheme.len()],
                    "<credentials>@",
                    &value[host_start..]
                );
            }
        }
    }
    value.into()
}

fn canonical_github_repository(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches('/');
    let path = if let Some(value) = trimmed.strip_prefix("git@github.com:") {
        value
    } else {
        let (scheme, rest) = trimmed.split_once("://")?;
        if !matches!(scheme, "http" | "https" | "ssh") {
            return None;
        }
        let (host, path) = rest.split_once('/')?;
        if host.rsplit('@').next()? != "github.com" {
            return None;
        }
        path
    };
    let path = path.trim_end_matches(".git");
    let mut parts = path.split('/');
    let owner = parts.next()?.trim();
    let repository = parts.next()?.trim();
    if owner.is_empty() || repository.is_empty() || parts.next().is_some() {
        return None;
    }
    Some(format!("{owner}/{repository}").to_ascii_lowercase())
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use tempfile::TempDir;

    #[test]
    fn literal_hash_and_shell_metacharacters_are_data() {
        let request = parse_request("--target-branch release/next #1145").unwrap();
        assert_eq!(request.target_branch, "release/next");
        assert!(request.sources.iter().any(|source| source.raw == "#1145"));
        let error = parse_request("'x;rm -rf'").unwrap_err();
        assert!(error.to_string().contains("invalid branch/ref selector"));
    }

    #[test]
    fn omitted_target_is_literal_main() {
        let request = parse_request("feature/auth").unwrap();
        assert_eq!(request.target_branch, "main");
        assert!(!request.target_explicit);
    }

    #[test]
    fn duplicate_selector_preserves_provenance() {
        let request = parse_request("#12 pr:12 #12").unwrap();
        assert_eq!(request.sources.len(), 1);
        assert_eq!(request.sources[0].canonical, "pr:12");
        assert_eq!(request.sources[0].provenance, vec!["#12", "pr:12", "#12"]);
    }

    #[test]
    fn repository_binding_deduplicates_pr_url_and_number() {
        let request =
            parse_request("--repo=acme/one #12 https://github.com/acme/one/pull/12?view=files")
                .unwrap();
        assert_eq!(request.sources.len(), 1);
        assert_eq!(request.sources[0].canonical, "pr:acme/one#12");
        assert_eq!(
            request.sources[0].provenance,
            vec!["#12", "https://github.com/acme/one/pull/12?view=files"]
        );
    }

    #[test]
    fn all_work_is_explicit_and_cleanup_is_bounded() {
        let request = parse_request("--all-work --cleanup=none").unwrap();
        assert!(request.all_work);
        assert_eq!(request.cleanup, "none");
        assert!(request.sources.is_empty());
    }

    #[test]
    fn duplicate_target_is_rejected() {
        let error =
            parse_request("--target-branch=main --target-branch=release feature").unwrap_err();
        assert!(error.to_string().contains("duplicate --target-branch"));
    }

    #[test]
    fn numeric_branch_requires_explicit_branch_prefix() {
        let request = parse_request("branch:1145").unwrap();
        assert_eq!(request.sources[0].kind, "branch");
        assert_eq!(request.sources[0].branch.as_deref(), Some("1145"));
    }

    #[test]
    fn url_repository_conflict_fails_closed() {
        let error =
            parse_request("https://github.com/acme/one/pull/1 https://github.com/acme/two/pull/2")
                .unwrap_err();
        assert!(error.to_string().contains("mixed-repository"));
    }

    #[test]
    fn list_urls_preserve_query_without_changing_selector_kind() {
        let request = parse_request("https://github.com/acme/one/pulls?state=open&page=2").unwrap();
        assert_eq!(request.sources[0].kind, "pulls-url");
        assert_eq!(
            request.sources[0].query.as_deref(),
            Some("state=open&page=2")
        );
        assert_eq!(request.repository.as_deref(), Some("acme/one"));
    }

    #[test]
    fn no_selectors_is_not_all_work() {
        let error = parse_request("").unwrap_err();
        assert!(error.to_string().contains("no selectors"));
    }

    #[test]
    fn campaign_binds_recorded_target() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path().join("repo");
        Command::new("git")
            .args(["init", "-q", "-b", "main", &repo.to_string_lossy()])
            .status()
            .unwrap();
        Command::new("git")
            .args([
                "-C",
                &repo.to_string_lossy(),
                "config",
                "user.email",
                "test@example.com",
            ])
            .status()
            .unwrap();
        Command::new("git")
            .args(["-C", &repo.to_string_lossy(), "config", "user.name", "Test"])
            .status()
            .unwrap();
        fs::write(repo.join("README"), "x").unwrap();
        Command::new("git")
            .args(["-C", &repo.to_string_lossy(), "add", "README"])
            .status()
            .unwrap();
        Command::new("git")
            .args(["-C", &repo.to_string_lossy(), "commit", "-qm", "init"])
            .status()
            .unwrap();
        let target = check_target(&repo, "main", None).unwrap();
        let request = parse_request("--target-branch=main feature").unwrap();
        let state_dir = temp.path().join("state");
        let state = init_campaign(&state_dir, &repo, request, target, None).unwrap();
        assert_eq!(state.target.target_branch, "main");
        let path = state_dir.join(format!("{}.json", state.campaign_id));
        let stored: CampaignState = read_json(&path).unwrap();
        assert_eq!(stored.campaign_id, state.campaign_id);
    }

    #[test]
    fn explicit_repository_binding_matches_origin_and_rejects_mismatch() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path().join("repo");
        Command::new("git")
            .args(["init", "-q", "-b", "main", &repo.to_string_lossy()])
            .status()
            .unwrap();
        Command::new("git")
            .args([
                "-C",
                &repo.to_string_lossy(),
                "config",
                "user.email",
                "test@example.com",
            ])
            .status()
            .unwrap();
        Command::new("git")
            .args(["-C", &repo.to_string_lossy(), "config", "user.name", "Test"])
            .status()
            .unwrap();
        fs::write(repo.join("README"), "x").unwrap();
        Command::new("git")
            .args(["-C", &repo.to_string_lossy(), "add", "README"])
            .status()
            .unwrap();
        Command::new("git")
            .args(["-C", &repo.to_string_lossy(), "commit", "-qm", "init"])
            .status()
            .unwrap();
        Command::new("git")
            .args([
                "-C",
                &repo.to_string_lossy(),
                "remote",
                "add",
                "origin",
                "git@github.com:acme/one.git",
            ])
            .status()
            .unwrap();

        let request = parse_request("--repo=acme/one --target-branch=main feature").unwrap();
        let target = check_target(&repo, "main", None).unwrap();
        let state_dir = temp.path().join("state");
        init_campaign(&state_dir, &repo, request.clone(), target.clone(), None).unwrap();

        Command::new("git")
            .args([
                "-C",
                &repo.to_string_lossy(),
                "remote",
                "set-url",
                "origin",
                "https://github.com/acme/two.git",
            ])
            .status()
            .unwrap();
        let error = init_campaign(
            &temp.path().join("mismatch-state"),
            &repo,
            request,
            target,
            None,
        )
        .unwrap_err();
        assert!(error.to_string().contains("repository binding mismatch"));
    }

    #[test]
    fn github_remote_identity_redacts_credentials_and_normalizes_forms() {
        assert_eq!(
            canonical_github_repository("https://token@github.com/acme/one.git"),
            Some("acme/one".into())
        );
        assert_eq!(
            canonical_github_repository("ssh://git@github.com/acme/one"),
            Some("acme/one".into())
        );
        assert_eq!(
            canonical_github_repository("git@github.com:acme/one.git"),
            Some("acme/one".into())
        );
        assert_eq!(
            canonical_github_repository("https://example.invalid/acme/one"),
            None
        );
        assert_eq!(
            canonical_github_repository("ftp://github.com/acme/one"),
            None
        );
    }

    #[test]
    fn concurrent_campaign_state_mutation_fails_closed() {
        let temp = TempDir::new().unwrap();
        let state_path = temp.path().join("campaign.json");
        let first = acquire_state_mutation_lock(&state_path).unwrap();
        let second = acquire_state_mutation_lock(&state_path);
        assert!(second.is_err());
        drop(first);
        assert!(acquire_state_mutation_lock(&state_path).is_ok());
    }
}
