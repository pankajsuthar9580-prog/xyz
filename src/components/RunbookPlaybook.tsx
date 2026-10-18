import React, { useState } from 'react';
import { 
  BookOpen, 
  CheckCircle2, 
  Terminal, 
  Cpu, 
  ShieldCheck, 
  Copy, 
  Check, 
  Layers, 
  ExternalLink,
  GitBranch,
  CloudLightning
} from 'lucide-react';

export const RunbookPlaybook: React.FC = () => {
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const copyToClipboard = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const steps = [
    {
      num: '01',
      title: 'Container Image Build & Push to Amazon ECR',
      description: 'Package the monitor container image and publish to your private Elastic Container Registry:',
      command: `# Authenticate Docker to AWS ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

# Build image with multi-platform support
docker build -t 123456789012.dkr.ecr.us-east-1.amazonaws.com/self-healing-monitor:latest .

# Push image
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/self-healing-monitor:latest`
    },
    {
      num: '02',
      title: 'Deploy Stack via Docker Compose on EC2',
      description: 'Clone the repository or mount configuration on the EC2 host and start the supervised stack:',
      command: `# Pull and launch stack in detached mode
docker compose up -d

# Verify both containers are up
docker compose ps`
    },
    {
      num: '03',
      title: 'Verify systemd Supervision & Restart Logic',
      description: 'Ensure systemd starts the daemon on boot and restarts automatically if terminated:',
      command: `# Check systemd status
systemctl status self-healing-monitor

# Stream journal logs
journalctl -u self-healing-monitor -f -o cat`
    },
    {
      num: '04',
      title: 'Execute Failure Injection Drills',
      description: 'Run the automated chaos script to trigger Tier 1 container restart and verify recovery:',
      command: `# Simulate container crash
./scripts/simulate_failure.sh kill-container

# Inspect status API to confirm healthy state restoration
curl -s http://localhost:8080/status | jq .`
    }
  ];

  return (
    <div className="flex flex-col gap-6 text-slate-100">
      {/* Top Banner */}
      <div className="p-5 bg-slate-900/90 border border-slate-800 rounded-lg">
        <h2 className="text-base font-semibold text-white tracking-tight">SRE Runbook & Deployment Playbook</h2>
        <p className="text-xs text-slate-400 mt-1">
          Operational deployment procedures, live failure drills, and architectural scaling roadmap.
        </p>
      </div>

      {/* Deployment Walkthrough */}
      <div className="space-y-4">
        {steps.map(step => (
          <div key={step.num} className="p-5 bg-slate-950 border border-slate-800 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-mono font-bold text-sky-400 px-2 py-0.5 bg-sky-950/60 rounded border border-sky-900/40">
                  {step.num}
                </span>
                <h3 className="text-sm font-semibold text-white">{step.title}</h3>
              </div>

              <button
                onClick={() => copyToClipboard(step.num, step.command)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer"
              >
                {copiedCmd === step.num ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCmd === step.num ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <p className="text-xs text-slate-300">{step.description}</p>

            <pre className="p-3 bg-slate-900/90 rounded border border-slate-800/80 font-mono text-xs text-sky-300 overflow-x-auto">
              <code>{step.command}</code>
            </pre>
          </div>
        ))}
      </div>

      {/* Architectural Improvements & Evolution */}
      <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-lg space-y-4">
        <h3 className="text-sm font-semibold text-white">Recommended Production Evolution Pathways</h3>
        <p className="text-xs text-slate-400">Next-level architecture patterns when scaling beyond a single EC2 host:</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-slate-950 rounded border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-sky-400 font-semibold text-xs">
              <CloudLightning className="w-4 h-4" />
              <span>1. AWS Auto Scaling Group (ASG) with ELB Checks</span>
            </div>
            <p className="text-xs text-slate-300">
              Wrap the single EC2 instance in a 1-node ASG (<code className="text-sky-300 font-mono">min=1, max=1</code>). Replace manual EC2 reboot with ASG instance replacement upon failed ELB target group health checks.
            </p>
          </div>

          <div className="p-4 bg-slate-950 rounded border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-purple-400 font-semibold text-xs">
              <Layers className="w-4 h-4" />
              <span>2. Amazon ECS with AWS Fargate</span>
            </div>
            <p className="text-xs text-slate-300">
              Migrate Docker Compose services into native ECS Task Definitions with Fargate. ECS automatically replaces failing tasks, manages rolling deployments, and provides circuit-breaker rollbacks.
            </p>
          </div>

          <div className="p-4 bg-slate-950 rounded border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
              <GitBranch className="w-4 h-4" />
              <span>3. Route 53 Active-Passive DNS Failover</span>
            </div>
            <p className="text-xs text-slate-300">
              Deploy a standby EC2 instance in a secondary Availability Zone. Configure Route 53 Health Checks against <code className="text-emerald-300 font-mono">:8080/health</code> to automatically shift DNS traffic on outage.
            </p>
          </div>

          <div className="p-4 bg-slate-950 rounded border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
              <ShieldCheck className="w-4 h-4" />
              <span>4. AWS Systems Manager (SSM) Session Manager</span>
            </div>
            <p className="text-xs text-slate-300">
              Close SSH port 22 in the Security Group entirely. Use AWS SSM Session Manager for secure, IAM-authorized, browser-based shell access with full audit logging in CloudTrail.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
