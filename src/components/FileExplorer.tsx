import React, { useState } from 'react';
import { SOURCE_FILES, CodeFile } from '../data/sourceCodeFiles';
import { 
  FileCode, 
  Folder, 
  Copy, 
  Check, 
  Download, 
  Search, 
  Terminal, 
  Cloud, 
  Shield, 
  Cpu, 
  FileText,
  FileCheck
} from 'lucide-react';
import JSZip from 'jszip';

export const FileExplorer: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<CodeFile>(SOURCE_FILES[0]);
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isZipping, setIsZipping] = useState(false);

  const categories = [
    { id: 'all', label: 'All Files' },
    { id: 'python', label: 'Python Modules' },
    { id: 'yaml', label: 'Config' },
    { id: 'docker', label: 'Docker' },
    { id: 'terraform', label: 'Terraform' },
    { id: 'systemd', label: 'Systemd' },
    { id: 'shell', label: 'Scripts & IAM' },
  ];

  const filteredFiles = SOURCE_FILES.filter(file => {
    const matchesSearch = file.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          file.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          file.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' ? true : 
      (selectedCategory === 'shell' ? (file.category === 'shell' || file.category === 'json') : file.category === selectedCategory);
    return matchesSearch && matchesCategory;
  });

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadZip = async () => {
    setIsZipping(true);
    try {
      const zip = new JSZip();
      const rootFolder = zip.folder('self_healing_monitor');

      SOURCE_FILES.forEach(file => {
        rootFolder?.file(file.path, file.content);
      });

      // Also add requirements.txt and sample html
      rootFolder?.file('requirements.txt', 'pyyaml>=6.0.1\npsutil>=5.9.8\ndocker>=7.0.0\nboto3>=1.34.0\nwatchtower>=3.0.1\n');
      rootFolder?.file('nginx-html/index.html', '<!DOCTYPE html><html><body><h1>Sample Monitored Web App</h1><p>Status: Healthy</p></body></html>');

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'self_healing_monitor_aws.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate ZIP archive', err);
    } finally {
      setIsZipping(false);
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'python': return <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'yaml': return <FileText className="w-4 h-4 text-amber-400 shrink-0" />;
      case 'docker': return <Cpu className="w-4 h-4 text-sky-400 shrink-0" />;
      case 'terraform': return <Cloud className="w-4 h-4 text-purple-400 shrink-0" />;
      case 'systemd': return <Terminal className="w-4 h-4 text-rose-400 shrink-0" />;
      case 'json': return <Shield className="w-4 h-4 text-emerald-300 shrink-0" />;
      case 'shell': return <Terminal className="w-4 h-4 text-yellow-400 shrink-0" />;
      default: return <FileText className="w-4 h-4 text-slate-400 shrink-0" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 rounded-lg border border-slate-800 overflow-hidden shadow-2xl">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-b border-slate-800 bg-slate-900/80">
        <div>
          <h2 className="text-base font-semibold text-white tracking-tight">Source Code & Infrastructure Artifacts</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Production-grade Python 3.11 modules, Docker Compose stacks, systemd unit, and Terraform AWS blueprints.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadZip}
            disabled={isZipping}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-900 bg-sky-400 hover:bg-sky-300 rounded-md transition-colors cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isZipping ? 'Archiving...' : 'Download Full Project (.ZIP)'}</span>
          </button>
        </div>
      </div>

      {/* Main split explorer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-[640px]">
        {/* Left Column: File Tree */}
        <div className="lg:col-span-4 border-r border-slate-800 flex flex-col bg-slate-900/40">
          {/* Search & Filter */}
          <div className="p-3 border-b border-slate-800 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Search file path or description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>

            {/* Filter buttons */}
            <div className="flex flex-wrap gap-1">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    selectedCategory === cat.id
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* File list items */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40 p-1">
            {filteredFiles.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No files found matching "{searchTerm}"
              </div>
            ) : (
              filteredFiles.map(file => {
                const isSelected = selectedFile.path === file.path;
                return (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFile(file)}
                    className={`w-full text-left p-2.5 rounded transition-all flex items-start gap-2.5 cursor-pointer ${
                      isSelected 
                        ? 'bg-slate-800/90 text-white border-l-2 border-sky-400' 
                        : 'hover:bg-slate-800/40 text-slate-300'
                    }`}
                  >
                    <div className="mt-0.5">{getCategoryIcon(file.category)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-mono font-medium truncate">{file.name}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{file.category}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5 font-sans">{file.description}</p>
                      <span className="text-[10px] text-slate-500 font-mono block truncate">
                        self_healing_monitor/{file.path}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Code Viewer */}
        <div className="lg:col-span-8 flex flex-col bg-slate-950">
          {/* File Header Bar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-900/60">
            <div className="flex items-center gap-2 min-w-0">
              <Folder className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="text-xs font-mono text-slate-400 truncate">
                self_healing_monitor/{selectedFile.path}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Description banner */}
          <div className="px-4 py-2 bg-slate-900/30 border-b border-slate-800/60 text-xs text-slate-400">
            {selectedFile.description}
          </div>

          {/* Code Text with line numbers */}
          <div className="flex-1 overflow-auto p-4 font-mono text-xs text-slate-200 leading-relaxed bg-slate-950">
            <pre className="overflow-x-auto whitespace-pre font-mono">
              <code>{selectedFile.content}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
