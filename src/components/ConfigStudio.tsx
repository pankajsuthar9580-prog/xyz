import React, { useState } from 'react';
import { Sliders, Copy, Check, Download, RotateCcw, ShieldCheck, CheckCircle2 } from 'lucide-react';

export const ConfigStudio: React.FC = () => {
  // Configuration parameters
  const [interval, setInterval] = useState<number>(15);
  const [failureThreshold, setFailureThreshold] = useState<number>(3);
  const [cooldown, setCooldown] = useState<number>(180);
  const [maxPerHour, setMaxPerHour] = useState<number>(5);
  const [backoffBase, setBackoffBase] = useState<number>(5);
  const [dryRun, setDryRun] = useState<boolean>(false);
  const [httpLatencySla, setHttpLatencySla] = useState<number>(1500);
  const [cpuThreshold, setCpuThreshold] = useState<number>(90);
  const [memThreshold, setMemThreshold] = useState<number>(92);
  const [diskThreshold, setDiskThreshold] = useState<number>(88);
  const [region, setRegion] = useState<string>('us-east-1');
  const [snsTopic, setSnsTopic] = useState<string>('arn:aws:sns:us-east-1:123456789012:self-healing-server-alerts');

  const [copied, setCopied] = useState(false);

  const generateYaml = () => {
    return `# ==============================================================================
# AWS Self-Healing Server Monitor Configuration (Custom Built)
# Generated dynamically via SRE Configuration Studio
# ==============================================================================

app:
  name: "aws-self-healing-monitor"
  environment: "production"
  check_interval_seconds: ${interval}
  dry_run: ${dryRun}
  http_status_api_port: 8080

safeguards:
  consecutive_failures_threshold: ${failureThreshold}
  cooldown_period_seconds: ${cooldown}
  max_recoveries_per_hour: ${maxPerHour}
  exponential_backoff_base_seconds: ${backoffBase}
  exponential_backoff_multiplier: 2.0
  max_backoff_seconds: 60

checks:
  http:
    - name: "sample-nginx-web"
      url: "http://localhost:80"
      expected_status_codes: [200, 301, 302]
      timeout_seconds: 3.5
      max_response_time_ms: ${httpLatencySla}
      enabled: true
      target_container: "sample-nginx"

  tcp:
    - name: "nginx-port-80"
      host: "127.0.0.1"
      port: 80
      timeout_seconds: 2.0
      enabled: true
      target_container: "sample-nginx"

  networking:
    ping:
      enabled: true
      target_hosts: ["1.1.1.1", "8.8.8.8"]
      count: 2
      timeout_seconds: 2.0
    dns:
      enabled: true
      domains: ["aws.amazon.com", "google.com"]
      timeout_seconds: 3.0

  docker:
    enabled: true
    socket_path: "unix://var/run/docker.sock"
    monitored_containers:
      - name: "sample-nginx"
        service_name: "web"
        compose_project_dir: "/opt/self-healing-monitor"
        max_acceptable_restarts_per_hour: 10
        require_running: true
        check_health_status: true

  system_metrics:
    enabled: true
    thresholds:
      cpu_percent: ${cpuThreshold}.0
      memory_percent: ${memThreshold}.0
      disk_percent: ${diskThreshold}.0
      disk_path: "/"

recovery:
  tier1_container_restart:
    enabled: true
    timeout_seconds: 30

  tier2_compose_recreate:
    enabled: true
    compose_file: "/opt/self-healing-monitor/docker-compose.yml"
    pull_latest: false
    timeout_seconds: 60

  tier3_host_service_restart:
    enabled: true
    services: ["docker.service"]
    timeout_seconds: 45

  tier4_ec2_reboot:
    enabled: true
    require_confirmation_attempts: 3
    drain_delay_seconds: 10

aws:
  region: "${region}"
  sns:
    enabled: true
    topic_arn: "${snsTopic}"
    events_to_notify:
      - "FAILURE_DETECTED"
      - "RECOVERY_ATTEMPTED"
      - "RECOVERY_SUCCEEDED"
      - "RECOVERY_FAILED"
      - "ESCALATION"
      - "SAFEGUARD_LOCKOUT"
      - "HOST_REBOOT_TRIGGERED"
  cloudwatch:
    enabled: true
    log_group: "/aws/ec2/self-healing-monitor"
    log_stream_prefix: "instance"
`;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generateYaml());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const yaml = generateYaml();
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'config.yaml';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setInterval(15);
    setFailureThreshold(3);
    setCooldown(180);
    setMaxPerHour(5);
    setBackoffBase(5);
    setDryRun(false);
    setHttpLatencySla(1500);
    setCpuThreshold(90);
    setMemThreshold(92);
    setDiskThreshold(88);
    setRegion('us-east-1');
  };

  return (
    <div className="flex flex-col gap-6 text-slate-100">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 bg-slate-900/90 border border-slate-800 rounded-lg">
        <div>
          <h2 className="text-base font-semibold text-white tracking-tight">Configuration Studio & Parameter Tuner</h2>
          <p className="text-xs text-slate-400 mt-1">
            Interactively tune check intervals, failure triggers, and safeguard boundaries. Generates valid production YAML.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 bg-sky-400 hover:bg-sky-300 rounded-md transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download config.yaml</span>
          </button>
        </div>
      </div>

      {/* Split: Controls vs Live YAML Output */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Interactive Controls */}
        <div className="lg:col-span-6 space-y-4">
          {/* Safeguard & Timing Controls */}
          <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-lg space-y-4">
            <h3 className="text-xs font-semibold text-sky-400 uppercase tracking-wider">
              Safeguards & Throttling
            </h3>

            {/* Interval Slider */}
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-300">Check Interval:</span>
                <span className="font-mono text-sky-400 font-semibold">{interval} seconds</span>
              </div>
              <input
                type="range"
                min="5"
                max="60"
                step="5"
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value))}
                className="w-full accent-sky-400 cursor-pointer"
              />
              <span className="text-[11px] text-slate-500">Frequency of running probe suite (t3.micro recommendation: 15s)</span>
            </div>

            {/* Failure Threshold */}
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-300">Consecutive Failures Threshold:</span>
                <span className="font-mono text-sky-400 font-semibold">{failureThreshold} failures</span>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={failureThreshold}
                onChange={(e) => setFailureThreshold(Number(e.target.value))}
                className="w-full accent-sky-400 cursor-pointer"
              />
              <span className="text-[11px] text-slate-500">Consecutive unhealthy probes required before initiating Tier 1 recovery</span>
            </div>

            {/* Cooldown Period */}
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-300">Cooldown Period:</span>
                <span className="font-mono text-sky-400 font-semibold">{cooldown}s ({Math.round(cooldown / 60)} min)</span>
              </div>
              <input
                type="range"
                min="30"
                max="600"
                step="30"
                value={cooldown}
                onChange={(e) => setCooldown(Number(e.target.value))}
                className="w-full accent-sky-400 cursor-pointer"
              />
              <span className="text-[11px] text-slate-500">Mandatory quiet period between recovery actions on the same service</span>
            </div>

            {/* Max Recoveries per hour */}
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-300">Max Recoveries per Hour:</span>
                <span className="font-mono text-sky-400 font-semibold">{maxPerHour} / hr</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={maxPerHour}
                onChange={(e) => setMaxPerHour(Number(e.target.value))}
                className="w-full accent-sky-400 cursor-pointer"
              />
              <span className="text-[11px] text-slate-500">Rate limit window to prevent restart storm/reboot loop</span>
            </div>
          </div>

          {/* SLA & Resource Thresholds */}
          <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-lg space-y-4">
            <h3 className="text-xs font-semibold text-purple-400 uppercase tracking-wider">
              Health Probe SLA Limits
            </h3>

            {/* HTTP SLA */}
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-300">HTTP Response Time SLA:</span>
                <span className="font-mono text-purple-400 font-semibold">{httpLatencySla} ms</span>
              </div>
              <input
                type="range"
                min="200"
                max="4000"
                step="100"
                value={httpLatencySla}
                onChange={(e) => setHttpLatencySla(Number(e.target.value))}
                className="w-full accent-purple-400 cursor-pointer"
              />
            </div>

            {/* CPU / Disk limits */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-xs text-slate-300 block mb-1">CPU Max: {cpuThreshold}%</span>
                <input
                  type="range"
                  min="60"
                  max="98"
                  value={cpuThreshold}
                  onChange={(e) => setCpuThreshold(Number(e.target.value))}
                  className="w-full accent-amber-400 cursor-pointer"
                />
              </div>
              <div>
                <span className="text-xs text-slate-300 block mb-1">Disk Max: {diskThreshold}%</span>
                <input
                  type="range"
                  min="60"
                  max="98"
                  value={diskThreshold}
                  onChange={(e) => setDiskThreshold(Number(e.target.value))}
                  className="w-full accent-amber-400 cursor-pointer"
                />
              </div>
            </div>

            {/* Dry Run Toggle */}
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-white block">Dry-Run Mode</span>
                <span className="text-[11px] text-slate-400">Simulate recovery logic and alerts without modifying containers or host</span>
              </div>
              <button
                onClick={() => setDryRun(!dryRun)}
                className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                  dryRun ? 'bg-sky-500 justify-end' : 'bg-slate-700 justify-start'
                }`}
              >
                <div className="w-4 h-4 bg-white rounded-full shadow" />
              </button>
            </div>
          </div>
        </div>

        {/* Right: Live YAML Preview */}
        <div className="lg:col-span-6 flex flex-col bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between p-3.5 border-b border-slate-800 bg-slate-900/60">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-medium text-white">config/config.yaml</span>
              <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Valid YAML
              </span>
            </div>

            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy YAML'}</span>
            </button>
          </div>

          <div className="flex-1 p-4 font-mono text-xs text-slate-200 overflow-auto max-h-[580px] bg-slate-950 leading-relaxed">
            <pre><code>{generateYaml()}</code></pre>
          </div>
        </div>
      </div>
    </div>
  );
};
