import React, { useState } from 'react';
import { FileExplorer } from './components/FileExplorer';
import { ChaosSimulator } from './components/ChaosSimulator';
import { ConfigStudio } from './components/ConfigStudio';
import { AwsArchitecture } from './components/AwsArchitecture';
import { RunbookPlaybook } from './components/RunbookPlaybook';
import { Download, Terminal, Layers } from 'lucide-react';
import JSZip from 'jszip';
import { SOURCE_FILES } from './data/sourceCodeFiles';

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'code' | 'config' | 'aws' | 'runbook'>('simulator');
  const [isExporting, setIsExporting] = useState(false);

  const handleExportZip = async () => {
    setIsExporting(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder('self_healing_monitor');

      SOURCE_FILES.forEach(file => {
        folder?.file(file.path, file.content);
      });

      folder?.file('requirements.txt', 'pyyaml>=6.0.1\npsutil>=5.9.8\ndocker>=7.0.0\nboto3>=1.34.0\nwatchtower>=3.0.1\n');
      folder?.file('nginx-html/index.html', '<!DOCTYPE html><html><body><h1>Sample Monitored Web App</h1><p>Status: Healthy</p></body></html>');

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'aws_self_healing_monitor.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col font-sans">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-800 bg-[#0f1420] shrink-0 sticky top-0 z-50">
        {/* Zone 1: Single text element wordmark */}
        <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
          <Terminal className="w-5 h-5 text-sky-400" />
          <span className="text-base font-bold tracking-tight text-white">
            AWS SRE Self-Healing Engine
          </span>
        </div>

        {/* Zone 2: 4-5 single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`transition-colors whitespace-nowrap shrink-0 pb-1 cursor-pointer ${
              activeTab === 'simulator' 
                ? 'text-white border-b-2 border-sky-400 font-semibold' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Chaos Simulator
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`transition-colors whitespace-nowrap shrink-0 pb-1 cursor-pointer ${
              activeTab === 'code' 
                ? 'text-white border-b-2 border-sky-400 font-semibold' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Source Code & Artifacts
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`transition-colors whitespace-nowrap shrink-0 pb-1 cursor-pointer ${
              activeTab === 'config' 
                ? 'text-white border-b-2 border-sky-400 font-semibold' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Config Studio
          </button>
          <button
            onClick={() => setActiveTab('aws')}
            className={`transition-colors whitespace-nowrap shrink-0 pb-1 cursor-pointer ${
              activeTab === 'aws' 
                ? 'text-white border-b-2 border-sky-400 font-semibold' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            AWS Architecture
          </button>
          <button
            onClick={() => setActiveTab('runbook')}
            className={`transition-colors whitespace-nowrap shrink-0 pb-1 cursor-pointer ${
              activeTab === 'runbook' 
                ? 'text-white border-b-2 border-sky-400 font-semibold' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Runbook & Playbook
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleExportZip}
            disabled={isExporting}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-slate-900 bg-sky-400 hover:bg-sky-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting ? 'Exporting...' : 'Export Project (.ZIP)'}</span>
          </button>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        {/* Mobile Navigation segmented control */}
        <div className="md:hidden flex items-center gap-1 p-1 bg-slate-900 rounded-lg overflow-x-auto border border-slate-800">
          {[
            { id: 'simulator', label: 'Simulator' },
            { id: 'code', label: 'Code' },
            { id: 'config', label: 'Config' },
            { id: 'aws', label: 'AWS' },
            { id: 'runbook', label: 'Runbook' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-sky-400 text-slate-900 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Active Tab View */}
        {activeTab === 'simulator' && <ChaosSimulator />}
        {activeTab === 'code' && <FileExplorer />}
        {activeTab === 'config' && <ConfigStudio />}
        {activeTab === 'aws' && <AwsArchitecture />}
        {activeTab === 'runbook' && <RunbookPlaybook />}
      </main>

      {/* Clean Uncluttered Footer */}
      <footer className="border-t border-slate-800 bg-[#0f1420] px-6 py-4 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span>Automated Server Recovery System</span>
            <span>·</span>
            <span>AWS EC2 & Docker SRE Architecture</span>
            <span>·</span>
            <span>Python 3.11</span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>Least-Privilege IAM</span>
            <span>·</span>
            <span>IMDSv2 Enforced</span>
            <span>·</span>
            <span>CloudWatch JSON Logs</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
