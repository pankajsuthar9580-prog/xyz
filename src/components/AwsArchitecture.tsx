import React, { useState } from 'react';
import { 
  Cloud, 
  Server, 
  Shield, 
  Bell, 
  FileText, 
  Check, 
  Copy, 
  Terminal, 
  Cpu, 
  Database,
  ArrowRight,
  ExternalLink,
  Lock
} from 'lucide-react';

export const AwsArchitecture: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'topology' | 'iam' | 'security_group' | 'terraform'>('topology');
  const [copied, setCopied] = useState<string | null>(null);

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const iamPolicyJson = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudWatchLogsShipment",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/ec2/self-healing-monitor:*"
    },
    {
      "Sid": "AllowSNSTopicPublishing",
      "Effect": "Allow",
      "Action": [
        "sns:Publish"
      ],
      "Resource": "arn:aws:sns:*:*:self-healing-server-alerts"
    },
    {
      "Sid": "AllowSelfInstanceRebootOnly",
      "Effect": "Allow",
      "Action": [
        "ec2:RebootInstances"
      ],
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringEquals": {
          "ec2:ResourceTag/SelfHealingMonitored": "true"
        }
      }
    },
    {
      "Sid": "AllowDescribeInstanceStatus",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeInstanceStatus"
      ],
      "Resource": "*"
    }
  ]
}`;

  return (
    <div className="flex flex-col gap-6 text-slate-100">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 bg-slate-900/90 border border-slate-800 rounded-lg">
        <div>
          <h2 className="text-base font-semibold text-white tracking-tight">AWS Infrastructure Blueprint & Security</h2>
          <p className="text-xs text-slate-400 mt-1">
            Least-privilege IAM roles, IMDSv2 token enforcement, minimal ingress security groups, and CloudWatch alarms.
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          {[
            { id: 'topology', label: 'Topology Diagram' },
            { id: 'iam', label: 'IAM Policy (Least-Privilege)' },
            { id: 'security_group', label: 'Security Group' },
            { id: 'terraform', label: 'Terraform Commands' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 1: Topology Diagram */}
      {activeTab === 'topology' && (
        <div className="p-6 bg-slate-950 border border-slate-800 rounded-lg space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Box 1: Internet & Ingress */}
            <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-sky-400">
                <Cloud className="w-5 h-5" />
                <h3 className="text-xs font-bold uppercase tracking-wider">Ingress & Network</h3>
              </div>
              <p className="text-xs text-slate-300">
                Internet Gateway routes incoming traffic through an EC2 Security Group restricted to required ports only:
              </p>
              <div className="space-y-1.5 font-mono text-xs">
                <div className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between">
                  <span className="text-slate-300">Port 80 TCP:</span>
                  <span className="text-emerald-400">Public HTTP Web</span>
                </div>
                <div className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between">
                  <span className="text-slate-300">Port 8080 TCP:</span>
                  <span className="text-sky-400">Status / Health API</span>
                </div>
                <div className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between">
                  <span className="text-slate-300">Port 22 TCP:</span>
                  <span className="text-amber-400">Admin SSH (Restricted)</span>
                </div>
              </div>
            </div>

            {/* Box 2: EC2 Host & Container Stack */}
            <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-purple-400">
                <Server className="w-5 h-5" />
                <h3 className="text-xs font-bold uppercase tracking-wider">EC2 Host (Ubuntu 22.04)</h3>
              </div>
              <p className="text-xs text-slate-300">
                Runs on t3.micro/t3.small with IMDSv2 enforced. Systemd supervises the monitor container or daemon:
              </p>
              <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between text-slate-300">
                  <span>systemd unit:</span>
                  <span className="text-sky-300">Restart=always</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Docker Socket:</span>
                  <span className="text-emerald-400">/var/run/docker.sock</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>IMDSv2 Tokens:</span>
                  <span className="text-purple-400">Required (TTL 60s)</span>
                </div>
              </div>
            </div>

            {/* Box 3: AWS Managed Services */}
            <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <Bell className="w-5 h-5" />
                <h3 className="text-xs font-bold uppercase tracking-wider">AWS Observability & Action</h3>
              </div>
              <p className="text-xs text-slate-300">
                CloudWatch receives structured JSON telemetry while SNS broadcasts critical alerts:
              </p>
              <div className="space-y-1.5 font-mono text-xs">
                <div className="p-2 bg-slate-950 rounded border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">CloudWatch Log Group</span>
                  <span className="text-slate-200">/aws/ec2/self-healing-monitor</span>
                </div>
                <div className="p-2 bg-slate-950 rounded border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">CloudWatch Alarm</span>
                  <span className="text-amber-400">StatusCheckFailed &gt;= 1</span>
                </div>
                <div className="p-2 bg-slate-950 rounded border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Amazon SNS Topic</span>
                  <span className="text-purple-300">self-healing-server-alerts</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: IAM Policy */}
      {activeTab === 'iam' && (
        <div className="p-5 bg-slate-950 border border-slate-800 rounded-lg space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Least-Privilege IAM Policy</h3>
              <p className="text-xs text-slate-400">
                Strictly scopes `ec2:RebootInstances` to instances carrying the tag `SelfHealingMonitored = "true"`.
              </p>
            </div>
            <button
              onClick={() => copyText('iam', iamPolicyJson)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer"
            >
              {copied === 'iam' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied === 'iam' ? 'Copied' : 'Copy Policy JSON'}</span>
            </button>
          </div>

          <pre className="p-4 bg-slate-900/80 rounded border border-slate-800 font-mono text-xs text-slate-200 overflow-x-auto leading-relaxed">
            <code>{iamPolicyJson}</code>
          </pre>
        </div>
      )}

      {/* Tab 3: Security Group */}
      {activeTab === 'security_group' && (
        <div className="p-5 bg-slate-950 border border-slate-800 rounded-lg space-y-4">
          <h3 className="text-sm font-semibold text-white">Security Group Rules Specification</h3>
          <p className="text-xs text-slate-400">Minimal ingress footprint with complete outbound internet/AWS API egress.</p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Protocol</th>
                  <th className="py-2.5 px-3">Port Range</th>
                  <th className="py-2.5 px-3">Source CIDR</th>
                  <th className="py-2.5 px-3">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                <tr>
                  <td className="py-2.5 px-3 text-sky-400 font-sans">Inbound</td>
                  <td className="py-2.5 px-3">TCP</td>
                  <td className="py-2.5 px-3">80</td>
                  <td className="py-2.5 px-3">0.0.0.0/0</td>
                  <td className="py-2.5 px-3 font-sans text-slate-400">Production Web Traffic (Nginx)</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-sky-400 font-sans">Inbound</td>
                  <td className="py-2.5 px-3">TCP</td>
                  <td className="py-2.5 px-3">8080</td>
                  <td className="py-2.5 px-3">0.0.0.0/0 (or internal)</td>
                  <td className="py-2.5 px-3 font-sans text-slate-400">Self-Healing Status API (/status)</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-sky-400 font-sans">Inbound</td>
                  <td className="py-2.5 px-3">TCP</td>
                  <td className="py-2.5 px-3">22</td>
                  <td className="py-2.5 px-3">Allowed Admin IP only</td>
                  <td className="py-2.5 px-3 font-sans text-slate-400">SSH Maintenance Access</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 text-emerald-400 font-sans">Outbound</td>
                  <td className="py-2.5 px-3">ALL</td>
                  <td className="py-2.5 px-3">0 - 65535</td>
                  <td className="py-2.5 px-3">0.0.0.0/0</td>
                  <td className="py-2.5 px-3 font-sans text-slate-400">AWS API endpoints, Docker hubs, NTP & DNS</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Terraform Commands */}
      {activeTab === 'terraform' && (
        <div className="p-5 bg-slate-950 border border-slate-800 rounded-lg space-y-4">
          <h3 className="text-sm font-semibold text-white">Terraform Provisioning Quickstart</h3>
          <p className="text-xs text-slate-400">Deploy the full infrastructure on your AWS account in under 3 minutes.</p>

          <div className="space-y-3 font-mono text-xs">
            <div>
              <span className="text-slate-400 font-sans block mb-1">1. Initialize Terraform Providers:</span>
              <div className="p-3 bg-slate-900 rounded border border-slate-800 text-sky-300">
                terraform -chdir=self_healing_monitor/terraform init
              </div>
            </div>

            <div>
              <span className="text-slate-400 font-sans block mb-1">2. Validate Plan with your Alert Email:</span>
              <div className="p-3 bg-slate-900 rounded border border-slate-800 text-sky-300">
                terraform -chdir=self_healing_monitor/terraform plan -var="alert_email=sre-team@company.com"
              </div>
            </div>

            <div>
              <span className="text-slate-400 font-sans block mb-1">3. Apply and Launch Stack:</span>
              <div className="p-3 bg-slate-900 rounded border border-slate-800 text-sky-300">
                terraform -chdir=self_healing_monitor/terraform apply -auto-approve -var="alert_email=sre-team@company.com"
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
