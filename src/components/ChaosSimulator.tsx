import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  RotateCcw, 
  AlertTriangle, 
  CheckCircle2, 
  Flame, 
  ShieldAlert, 
  Server, 
  Terminal, 
  Bell, 
  Layers, 
  Cpu, 
  Activity,
  ArrowRight,
  Radio,
  Lock,
  RefreshCw,
  Copy,
  Check
} from 'lucide-react';

interface LogRecord {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'RECOVERY';
  eventType: string;
  message: string;
  details: Record<string, any>;
}

interface SNSAlert {
  id: string;
  timestamp: string;
  eventType: string;
  subject: string;
  body: string;
  payload: Record<string, any>;
}

export const ChaosSimulator: React.FC = () => {
  // State variables for the simulated monitor
  const [consecutiveFailures, setConsecutiveFailures] = useState<number>(0);
  const [activeTier, setActiveTier] = useState<number>(0);
  const [attemptCount, setAttemptCount] = useState<number>(0);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const [hourlyRecoveries, setHourlyRecoveries] = useState<number>(0);
  const [isLockedOut, setIsLockedOut] = useState<boolean>(false);
  const [systemState, setSystemState] = useState<'nominal' | 'degraded' | 'recovering' | 'locked_out' | 'rebooting'>('nominal');
  const [activeIncident, setActiveIncident] = useState<string | null>(null);

  // Simulated metrics
  const [httpLatency, setHttpLatency] = useState<number>(42);
  const [httpStatus, setHttpStatus] = useState<number>(200);
  const [containerRunning, setContainerRunning] = useState<boolean>(true);
  const [cpuUsage, setCpuUsage] = useState<number>(18.4);
  const [diskUsage, setDiskUsage] = useState<number>(34.2);

  // Logs & Alerts
  const [logs, setLogs] = useState<LogRecord[]>([
    {
      id: 'init-1',
      timestamp: new Date().toISOString(),
      level: 'INFO',
      eventType: 'DAEMON_STARTED',
      message: 'AWS Self-Healing Monitor daemon initialized on i-04d8b9f1234c5678a',
      details: { instance_id: 'i-04d8b9f1234c5678a', region: 'us-east-1', dry_run: false }
    },
    {
      id: 'init-2',
      timestamp: new Date().toISOString(),
      level: 'INFO',
      eventType: 'HEALTH_CYCLE_OK',
      message: 'All 5 health checks nominal (HTTP 200, TCP:80 open, Docker running, Ping ok)',
      details: { latency_ms: 42, cpu_percent: 18.4, disk_percent: 34.2 }
    }
  ]);

  const [alerts, setAlerts] = useState<SNSAlert[]>([]);
  const [logFilter, setLogFilter] = useState<string>('ALL');
  const [logsCopied, setLogsCopied] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Cooldown countdown effect
  useEffect(() => {
    if (cooldownRemaining > 0) {
      const timer = setInterval(() => {
        setCooldownRemaining(prev => Math.max(0, prev - 1));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [cooldownRemaining]);

  const addLog = (level: 'INFO' | 'WARN' | 'ERROR' | 'RECOVERY', eventType: string, message: string, details: Record<string, any>) => {
    const newRecord: LogRecord = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      level,
      eventType,
      message,
      details
    };
    setLogs(prev => [newRecord, ...prev].slice(0, 100));
  };

  const addAlert = (eventType: string, subject: string, body: string, payload: Record<string, any>) => {
    const newAlert: SNSAlert = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      eventType,
      subject,
      body,
      payload
    };
    setAlerts(prev => [newAlert, ...prev].slice(0, 50));
  };

  // Chaos: Scenario 1 - Kill Container (Recovers via Tier 1)
  const injectKillContainer = () => {
    setActiveIncident('Container Stopped / HTTP 502');
    setContainerRunning(false);
    setHttpStatus(502);
    setSystemState('degraded');

    addLog('WARN', 'FAILURE_DETECTED', "Container 'sample-nginx' exited unexpectedly with code 137 (SIGKILL)", {
      target: 'sample-nginx',
      exit_code: 137,
      http_status: 502
    });

    // Consecutive failure 1
    setConsecutiveFailures(1);

    setTimeout(() => {
      setConsecutiveFailures(2);
      addLog('WARN', 'FAILURE_DETECTED', "Consecutive check failure (2/3) for 'sample-nginx'", {
        consecutive_failures: 2,
        threshold: 3
      });
    }, 1200);

    setTimeout(() => {
      setConsecutiveFailures(3);
      setSystemState('recovering');
      setActiveTier(1);
      setAttemptCount(prev => prev + 1);
      setHourlyRecoveries(prev => prev + 1);
      setCooldownRemaining(15);

      addLog('RECOVERY', 'RECOVERY_INITIATED', "Consecutive failure threshold reached (3/3). Executing Tier 1: docker restart sample-nginx", {
        tier: 1,
        action: 'docker restart sample-nginx',
        attempt: 1,
        backoff_seconds: 5
      });

      addAlert(
        'RECOVERY_ATTEMPTED',
        '[TIER 1 RECOVERY] Restarting sample-nginx container',
        "Target 'sample-nginx' failed 3 consecutive health probes. Initiating container restart.",
        { tier: 1, target: 'sample-nginx', action: 'docker restart' }
      );

      // Successfully recovers after 2s
      setTimeout(() => {
        setContainerRunning(true);
        setHttpStatus(200);
        setSystemState('nominal');
        setActiveTier(0);
        setConsecutiveFailures(0);
        setActiveIncident(null);

        addLog('INFO', 'RECOVERY_SUCCEEDED', "Tier 1 recovery succeeded. Container 'sample-nginx' healthy, HTTP 200 restored.", {
          target: 'sample-nginx',
          tier: 1,
          restored_latency_ms: 38
        });

        addAlert(
          'RECOVERY_SUCCEEDED',
          '[RESOLVED] Tier 1 recovery succeeded for sample-nginx',
          "Container restarted cleanly. HTTP 200 verified on port 80.",
          { status: 'RESOLVED', tier: 1, target: 'sample-nginx' }
        );
      }, 2200);
    }, 2400);
  };

  // Chaos: Scenario 2 - Block Port 80 with iptables (Escalates Tier 1 -> Tier 2 -> Tier 3)
  const injectCascadingFailure = () => {
    setActiveIncident('Network Port 80 Dropped (iptables DROP)');
    setHttpStatus(0);
    setHttpLatency(3500);
    setSystemState('degraded');

    addLog('ERROR', 'FAILURE_DETECTED', 'TCP handshake connection refused on 127.0.0.1:80 & HTTP timeout (3500ms > SLA 1500ms)', {
      port: 80,
      host: '127.0.0.1',
      latency_ms: 3500
    });

    setConsecutiveFailures(3);
    setSystemState('recovering');
    setActiveTier(1);
    setHourlyRecoveries(prev => prev + 1);

    // Tier 1 fails
    setTimeout(() => {
      addLog('WARN', 'RECOVERY_FAILED', "Tier 1: Container restarted, but TCP port 80 still unresponsive. Escalating to Tier 2.", {
        tier: 1,
        outcome: 'unresolved'
      });
      setActiveTier(2);
      setHourlyRecoveries(prev => prev + 1);

      addAlert(
        'ESCALATION',
        '[TIER 2 ESCALATION] docker compose --force-recreate initiated',
        'Tier 1 soft restart failed. Triggering full stack recreation via Docker Compose.',
        { tier: 2, target: 'web-stack' }
      );

      // Tier 2 fails
      setTimeout(() => {
        addLog('WARN', 'RECOVERY_FAILED', "Tier 2: Stack recreation complete, but host port binding still dropped. Escalating to Tier 3.", {
          tier: 2,
          outcome: 'unresolved'
        });
        setActiveTier(3);
        setHourlyRecoveries(prev => prev + 1);

        addAlert(
          'ESCALATION',
          '[TIER 3 ESCALATION] Restarting host service docker.service',
          'Tiers 1 & 2 failed to restore port 80. Executing systemctl restart docker.service.',
          { tier: 3, target: 'docker.service' }
        );

        // Tier 3 fails -> Escalates to Tier 4 EC2 Reboot
        setTimeout(() => {
          setActiveTier(4);
          setSystemState('rebooting');
          setHourlyRecoveries(prev => prev + 1);

          addLog('ERROR', 'HOST_REBOOT_TRIGGERED', "All lower tiers exhausted. Initiating Tier 4: AWS EC2 RebootInstances via boto3.", {
            tier: 4,
            instance_id: 'i-04d8b9f1234c5678a',
            api: 'ec2:RebootInstances',
            grace_delay_sec: 10
          });

          addAlert(
            'HOST_REBOOT_TRIGGERED',
            '[CRITICAL] EC2 RebootInstances issued for i-04d8b9f1234c5678a',
            'SRE Tier 4 last-resort host reboot triggered. All services will reinitialize via systemd upon instance boot.',
            { tier: 4, instance_id: 'i-04d8b9f1234c5678a', action: 'RebootInstances' }
          );

          // Simulated reboot completion
          setTimeout(() => {
            setSystemState('nominal');
            setActiveTier(0);
            setConsecutiveFailures(0);
            setHttpStatus(200);
            setHttpLatency(45);
            setActiveIncident(null);
            addLog('INFO', 'INSTANCE_REBOOT_COMPLETED', 'EC2 Instance reboot finished. systemd started monitor daemon. Stack healthy.', {
              instance_id: 'i-04d8b9f1234c5678a',
              uptime: '0m 45s'
            });
          }, 4000);
        }, 2200);
      }, 2000);
    }, 1800);
  };

  // Chaos: Scenario 3 - Flapping Storm (Triggers Safeguard Lockout)
  const injectFlappingStorm = () => {
    setActiveIncident('Flapping Loop (5 recoveries in 60m)');
    setHourlyRecoveries(5);
    setIsLockedOut(true);
    setSystemState('locked_out');
    setConsecutiveFailures(3);

    addLog('ERROR', 'SAFEGUARD_LOCKOUT', 'Target reached maximum hourly limit (5/5 recoveries in last 60m). Recovery suppressed to prevent reboot storm.', {
      target: 'sample-nginx',
      hourly_limit: 5,
      safeguard_state: 'LOCKED_OUT'
    });

    addAlert(
      'SAFEGUARD_LOCKOUT',
      '[SAFEGUARD LOCKOUT] sample-nginx exceeded hourly recovery threshold',
      'Flapping prevention triggered. 5 recoveries performed in under 60 minutes. SRE on-call intervention required.',
      { safeguard: 'MAX_RECOVERIES_PER_HOUR', target: 'sample-nginx', limit: 5 }
    );
  };

  // Chaos: Scenario 4 - Host Resource Exhaustion
  const injectResourceExhaustion = () => {
    setActiveIncident('Host Disk & Memory Threshold Breach');
    setCpuUsage(94.8);
    setDiskUsage(92.1);
    setSystemState('degraded');

    addLog('WARN', 'FAILURE_DETECTED', 'Host resource thresholds breached: CPU at 94.8% (>90%), Root Disk at 92.1% (>88%)', {
      cpu_percent: 94.8,
      cpu_threshold: 90.0,
      disk_percent: 92.1,
      disk_threshold: 88.0,
      free_disk_gb: 1.4
    });

    addAlert(
      'FAILURE_DETECTED',
      '[CAPACITY ALERT] Host CPU & Disk threshold breach',
      'EC2 root volume / reached 92.1% capacity and CPU sustained at 94.8%. Storage cleanup recommended.',
      { cpu_percent: 94.8, disk_percent: 92.1 }
    );
  };

  // Reset to nominal
  const handleReset = () => {
    setConsecutiveFailures(0);
    setActiveTier(0);
    setAttemptCount(0);
    setCooldownRemaining(0);
    setHourlyRecoveries(0);
    setIsLockedOut(false);
    setSystemState('nominal');
    setActiveIncident(null);
    setHttpLatency(38);
    setHttpStatus(200);
    setContainerRunning(true);
    setCpuUsage(19.2);
    setDiskUsage(35.0);

    addLog('INFO', 'HEALTH_CYCLE_OK', 'All systems manually normalized. Diagnostics green.', {
      status: 'nominal',
      checked_at: new Date().toISOString()
    });
  };

  const copyLogs = () => {
    const text = logs.map(l => JSON.stringify(l)).join('\n');
    navigator.clipboard.writeText(text);
    setLogsCopied(true);
    setTimeout(() => setLogsCopied(false), 2000);
  };

  const filteredLogs = logs.filter(l => {
    if (logFilter === 'ALL') return true;
    return l.level === logFilter;
  });

  return (
    <div className="flex flex-col gap-6 text-slate-100">
      {/* Simulation Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 bg-slate-900/90 border border-slate-800 rounded-lg">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-white tracking-tight">Interactive Self-Healing Simulator</h2>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-400">Target EC2:</span>
              <span className="font-mono text-sky-400 font-medium">i-04d8b9f1234c5678a</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">Region:</span>
              <span className="font-mono text-purple-400">us-east-1</span>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Simulate container crashes, port drops, and resource spikes to observe 4-tier recovery, backoff, and safeguards in action.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span>Reset All to Nominal</span>
          </button>
        </div>
      </div>

      {/* State Dashboard Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* State Status Card */}
        <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-lg">
          <span className="text-xs text-slate-400 font-medium">System Health State</span>
          <div className="mt-2 flex items-center gap-2">
            {systemState === 'nominal' && (
              <div className="flex items-center gap-1.5 text-emerald-400 text-sm font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                <span>Nominal (Healthy)</span>
              </div>
            )}
            {systemState === 'degraded' && (
              <div className="flex items-center gap-1.5 text-amber-400 text-sm font-semibold">
                <AlertTriangle className="w-4 h-4" />
                <span>Degraded (Probing)</span>
              </div>
            )}
            {systemState === 'recovering' && (
              <div className="flex items-center gap-1.5 text-sky-400 text-sm font-semibold">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Self-Healing (Tier {activeTier})</span>
              </div>
            )}
            {systemState === 'rebooting' && (
              <div className="flex items-center gap-1.5 text-purple-400 text-sm font-semibold">
                <Server className="w-4 h-4 animate-pulse" />
                <span>Tier 4: Rebooting Host</span>
              </div>
            )}
            {systemState === 'locked_out' && (
              <div className="flex items-center gap-1.5 text-rose-400 text-sm font-semibold">
                <Lock className="w-4 h-4" />
                <span>Safeguard Lockout</span>
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1 truncate">
            {activeIncident || 'All health checks passing SLA'}
          </p>
        </div>

        {/* Consecutive Failures */}
        <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-lg">
          <span className="text-xs text-slate-400 font-medium">Consecutive Failures</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-mono font-bold text-white tabular-nums">{consecutiveFailures}</span>
            <span className="text-xs text-slate-400 font-mono">/ 3 threshold</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 ${
                consecutiveFailures >= 3 ? 'bg-rose-500' : (consecutiveFailures > 0 ? 'bg-amber-400' : 'bg-slate-700')
              }`}
              style={{ width: `${Math.min(100, (consecutiveFailures / 3) * 100)}%` }}
            />
          </div>
        </div>

        {/* Hourly Recoveries */}
        <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-lg">
          <span className="text-xs text-slate-400 font-medium">Recoveries Past Hour</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-xl font-mono font-bold tabular-nums ${hourlyRecoveries >= 5 ? 'text-rose-400' : 'text-white'}`}>
              {hourlyRecoveries}
            </span>
            <span className="text-xs text-slate-400 font-mono">/ 5 max allowed</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 ${
                hourlyRecoveries >= 5 ? 'bg-rose-500' : (hourlyRecoveries >= 3 ? 'bg-amber-400' : 'bg-sky-400')
              }`}
              style={{ width: `${Math.min(100, (hourlyRecoveries / 5) * 100)}%` }}
            />
          </div>
        </div>

        {/* Cooldown Timer */}
        <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-lg">
          <span className="text-xs text-slate-400 font-medium">Cooldown Guard</span>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl font-mono font-bold text-white tabular-nums">
              {cooldownRemaining}s
            </span>
            <span className="text-xs text-slate-400">
              {cooldownRemaining > 0 ? 'active' : 'idle'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {cooldownRemaining > 0 ? 'Throttling re-trigger' : 'Ready to act if unhealthy'}
          </p>
        </div>

        {/* Monitored Metrics summary */}
        <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-lg">
          <span className="text-xs text-slate-400 font-medium">Live Probe Telemetry</span>
          <div className="mt-1.5 space-y-1 font-mono text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">HTTP / Nginx:</span>
              <span className={httpStatus === 200 ? 'text-emerald-400' : 'text-rose-400 font-semibold'}>
                {httpStatus > 0 ? `${httpStatus} (${httpLatency}ms)` : 'TIMEOUT'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Container:</span>
              <span className={containerRunning ? 'text-emerald-400' : 'text-rose-400 font-semibold'}>
                {containerRunning ? 'RUNNING' : 'EXITED'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">CPU / Disk:</span>
              <span className={(cpuUsage > 90 || diskUsage > 88) ? 'text-amber-400' : 'text-slate-300'}>
                {cpuUsage}% / {diskUsage}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4-Tier Recovery Ladder Visualizer */}
      <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-lg">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Tiered Recovery Escalation Ladder</h3>
            <p className="text-xs text-slate-400">Progressive recovery stages with exponential backoff & confirmation delays.</p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            Current Tier: <span className="text-sky-400 font-bold">{activeTier > 0 ? `Tier ${activeTier}` : 'Idle (Nominal)'}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Tier 1 */}
          <div className={`p-3.5 rounded-lg border transition-all ${
            activeTier === 1 
              ? 'bg-sky-950/60 border-sky-400 shadow-lg shadow-sky-950' 
              : 'bg-slate-950 border-slate-800/80'
          }`}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-sky-400">Tier 1: Soft Restart</span>
              <span className="text-[10px] text-slate-400 font-mono">Attempts 1-2</span>
            </div>
            <p className="text-xs text-slate-300 font-mono mt-1.5">docker restart sample-nginx</p>
            <p className="text-[11px] text-slate-400 mt-2">
              Restarts the single failed container in-place via Docker daemon socket.
            </p>
          </div>

          {/* Tier 2 */}
          <div className={`p-3.5 rounded-lg border transition-all ${
            activeTier === 2 
              ? 'bg-purple-950/60 border-purple-400 shadow-lg shadow-purple-950' 
              : 'bg-slate-950 border-slate-800/80'
          }`}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-purple-400">Tier 2: Stack Recreate</span>
              <span className="text-[10px] text-slate-400 font-mono">Attempt 3</span>
            </div>
            <p className="text-xs text-slate-300 font-mono mt-1.5">docker compose --force-recreate</p>
            <p className="text-[11px] text-slate-400 mt-2">
              Destroys and recreates container, refreshing network interfaces & volume mounts.
            </p>
          </div>

          {/* Tier 3 */}
          <div className={`p-3.5 rounded-lg border transition-all ${
            activeTier === 3 
              ? 'bg-amber-950/60 border-amber-400 shadow-lg shadow-amber-950' 
              : 'bg-slate-950 border-slate-800/80'
          }`}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-amber-400">Tier 3: Host Service</span>
              <span className="text-[10px] text-slate-400 font-mono">Attempt 4</span>
            </div>
            <p className="text-xs text-slate-300 font-mono mt-1.5">systemctl restart docker</p>
            <p className="text-[11px] text-slate-400 mt-2">
              Restarts host daemon or system networking stack via systemd socket.
            </p>
          </div>

          {/* Tier 4 */}
          <div className={`p-3.5 rounded-lg border transition-all ${
            activeTier === 4 
              ? 'bg-rose-950/60 border-rose-400 shadow-lg shadow-rose-950' 
              : 'bg-slate-950 border-slate-800/80'
          }`}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-rose-400">Tier 4: EC2 Reboot</span>
              <span className="text-[10px] text-slate-400 font-mono">Last Resort</span>
            </div>
            <p className="text-xs text-slate-300 font-mono mt-1.5">boto3 ec2.reboot_instances()</p>
            <p className="text-[11px] text-slate-400 mt-2">
              Issues AWS API reboot scoped to instance ID after 10s grace flush.
            </p>
          </div>
        </div>
      </div>

      {/* Chaos Control Panel Buttons */}
      <div className="p-5 bg-slate-900/90 border border-slate-800 rounded-lg">
        <h3 className="text-sm font-semibold text-white mb-2">Simulate Incident Scenarios (Chaos Injection)</h3>
        <p className="text-xs text-slate-400 mb-4">Click a scenario button to trigger failure modes and observe the self-healing monitor's automated actions.</p>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            onClick={injectKillContainer}
            className="flex items-center gap-2.5 p-3 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 text-left transition-colors cursor-pointer"
          >
            <Flame className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <span className="text-xs font-semibold text-white block">1. Kill Sample Container</span>
              <span className="text-[11px] text-slate-400">Tests Tier 1 container restart</span>
            </div>
          </button>

          <button
            onClick={injectCascadingFailure}
            className="flex items-center gap-2.5 p-3 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 text-left transition-colors cursor-pointer"
          >
            <AlertTriangle className="w-4 h-4 text-purple-400 shrink-0" />
            <div>
              <span className="text-xs font-semibold text-white block">2. Cascading Fault (Port 80)</span>
              <span className="text-[11px] text-slate-400">Escalates Tier 1 → 2 → 3 → 4</span>
            </div>
          </button>

          <button
            onClick={injectFlappingStorm}
            className="flex items-center gap-2.5 p-3 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 text-left transition-colors cursor-pointer"
          >
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <div>
              <span className="text-xs font-semibold text-white block">3. Flapping Loop Test</span>
              <span className="text-[11px] text-slate-400">Triggers 5/hr safeguard lockout</span>
            </div>
          </button>

          <button
            onClick={injectResourceExhaustion}
            className="flex items-center gap-2.5 p-3 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 text-left transition-colors cursor-pointer"
          >
            <Cpu className="w-4 h-4 text-yellow-400 shrink-0" />
            <div>
              <span className="text-xs font-semibold text-white block">4. Disk / CPU Spike</span>
              <span className="text-[11px] text-slate-400">Tests psutil capacity alert</span>
            </div>
          </button>
        </div>
      </div>

      {/* Split Viewer: CloudWatch Structured Logs vs AWS SNS Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: CloudWatch Logs */}
        <div className="lg:col-span-7 flex flex-col bg-slate-950 border border-slate-800 rounded-lg overflow-hidden min-h-[460px]">
          <div className="flex items-center justify-between p-3.5 border-b border-slate-800 bg-slate-900/70">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-semibold text-white">CloudWatch Log Stream (/aws/ec2/self-healing-monitor)</span>
            </div>

            <div className="flex items-center gap-2">
              {/* Filter tabs */}
              <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded border border-slate-800">
                {['ALL', 'INFO', 'WARN', 'RECOVERY', 'ERROR'].map(f => (
                  <button
                    key={f}
                    onClick={() => setLogFilter(f)}
                    className={`px-1.5 py-0.5 text-[10px] font-mono rounded cursor-pointer ${
                      logFilter === f ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>

              <button
                onClick={copyLogs}
                className="p-1 text-slate-400 hover:text-white bg-slate-800 rounded transition-colors cursor-pointer"
                title="Copy structured JSON logs"
              >
                {logsCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 font-mono text-xs max-h-[480px]">
            {filteredLogs.length === 0 ? (
              <div className="text-slate-500 text-center py-10">No log entries matching filter</div>
            ) : (
              filteredLogs.map(log => {
                const getBadgeColor = (lvl: string) => {
                  switch (lvl) {
                    case 'INFO': return 'text-slate-300';
                    case 'WARN': return 'text-amber-400 font-semibold';
                    case 'ERROR': return 'text-rose-400 font-semibold';
                    case 'RECOVERY': return 'text-sky-400 font-bold';
                    default: return 'text-slate-400';
                  }
                };

                return (
                  <div key={log.id} className="p-2 rounded bg-slate-900/40 border border-slate-800/60 hover:border-slate-700 transition-colors">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                      <div className="flex items-center gap-2">
                        <span className={getBadgeColor(log.level)}>[{log.level}]</span>
                        <span className="text-slate-300">{log.eventType}</span>
                      </div>
                      <span className="text-[10px] tabular-nums">{log.timestamp.slice(11, 23)}Z</span>
                    </div>
                    <p className="text-slate-200 font-sans text-xs">{log.message}</p>
                    <div className="mt-1 text-[10px] text-slate-400 font-mono bg-slate-950 p-1.5 rounded border border-slate-900 overflow-x-auto">
                      {JSON.stringify(log.details)}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Right Column: AWS SNS Alerts Feed */}
        <div className="lg:col-span-5 flex flex-col bg-slate-950 border border-slate-800 rounded-lg overflow-hidden min-h-[460px]">
          <div className="flex items-center justify-between p-3.5 border-b border-slate-800 bg-slate-900/70">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-semibold text-white">Amazon SNS Notification Topic</span>
            </div>
            <span className="text-[11px] font-mono text-purple-300">
              {alerts.length} received
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 max-h-[480px]">
            {alerts.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                <Radio className="w-8 h-8 mx-auto mb-2 opacity-30 text-purple-400" />
                No SNS alerts published yet. Trigger a failure scenario above to generate an SNS notification.
              </div>
            ) : (
              alerts.map(alert => (
                <div key={alert.id} className="p-3 bg-purple-950/20 border border-purple-900/40 rounded-lg">
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="font-semibold text-purple-300 font-mono">{alert.eventType}</span>
                    <span className="text-slate-500 text-[10px] tabular-nums font-mono">{alert.timestamp.slice(11, 19)}Z</span>
                  </div>
                  <h4 className="text-xs font-medium text-white mb-1">{alert.subject}</h4>
                  <p className="text-[11px] text-slate-300 mb-2">{alert.body}</p>
                  <pre className="text-[10px] text-slate-400 font-mono bg-slate-950 p-1.5 rounded border border-slate-900 overflow-x-auto">
                    {JSON.stringify(alert.payload, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
