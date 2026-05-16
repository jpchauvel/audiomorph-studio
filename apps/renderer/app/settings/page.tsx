'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAppStore } from '@/lib/stores/app';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const API_BASE = () =>
  (typeof window !== 'undefined' && (window as any).__AUDIOMORPH_API_BASE__) || 'http://localhost:8000';
const TOKEN = () =>
  (typeof window !== 'undefined' && (window as any).__AUDIOMORPH_TOKEN__) || '';
const headers = () => ({ 'X-Audiomorph-Token': TOKEN(), 'Content-Type': 'application/json' });

export default function SettingsPage() {
  const { theme, setTheme } = useAppStore();
  const [modelsDir, setModelsDir] = useState<string>('');
  const [cpuFallback, setCpuFallback] = useState<boolean>(false);
  const [openrouterKeyPresent, setOpenrouterKeyPresent] = useState<boolean>(false);
  const [hfTokenPresent, setHfTokenPresent] = useState<boolean>(false);

  const [orKeyInput, setOrKeyInput] = useState('');
  const [hfTokenInput, setHfTokenInput] = useState('');

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch(`${API_BASE()}/settings`, { headers: headers() });
        if (!res.ok) throw new Error('Failed to fetch settings');
        const data = await res.json();
        
        if (data.models_dir) setModelsDir(data.models_dir);
        if (data.cpu_fallback_enabled) setCpuFallback(data.cpu_fallback_enabled === 'true');
        if (data.openrouter_key_present) setOpenrouterKeyPresent(data.openrouter_key_present === 'true');
        if (data.hf_token_present) setHfTokenPresent(data.hf_token_present === 'true');
      } catch (err) {
        console.error(err);
      }
    }
    fetchSettings();
  }, []);

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  const handleCpuFallbackChange = async (checked: boolean) => {
    setCpuFallback(checked);
    try {
      await fetch(`${API_BASE()}/settings/cpu_fallback_enabled`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ value: checked ? 'true' : 'false' }),
      });
      toast.success('Performance setting updated');
    } catch (err) {
      toast.error('Failed to update performance setting');
      setCpuFallback(!checked);
    }
  };

  const saveOpenRouterKey = async () => {
    if (!orKeyInput.trim()) return;
    try {
      await (window as any).__AUDIOMORPH_IPC__?.setOpenRouterKey?.(orKeyInput);
      await fetch(`${API_BASE()}/settings/openrouter_key_present`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ value: 'true' }),
      });
      setOpenrouterKeyPresent(true);
      setOrKeyInput('');
      toast.success('OpenRouter key saved');
    } catch (err) {
      toast.error('Failed to save OpenRouter key');
    }
  };

  const saveHfToken = async () => {
    if (!hfTokenInput.trim()) return;
    try {
      await (window as any).__AUDIOMORPH_IPC__?.setHfToken?.(hfTokenInput);
      await fetch(`${API_BASE()}/settings/hf_token_present`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ value: 'true' }),
      });
      setHfTokenPresent(true);
      setHfTokenInput('');
      toast.success('HuggingFace token saved');
    } catch (err) {
      toast.error('Failed to save HuggingFace token');
    }
  };

  const changeModelsDir = async () => {
    try {
      const dir = await (window as any).__AUDIOMORPH_IPC__?.openDirectory?.();
      if (dir) {
        setModelsDir(dir);
        await fetch(`${API_BASE()}/settings/models_dir`, {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({ value: dir }),
        });
        toast.success('Models directory updated');
      }
    } catch (err) {
      toast.error('Failed to update models directory');
    }
  };

  const version = (typeof window !== 'undefined' ? (window as any).__AUDIOMORPH_VERSION__ : null) ?? '0.1.0';

  return (
    <div className="container mx-auto p-8 space-y-8 max-w-3xl">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Customize the look and feel of the application.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="theme-toggle" className="text-base font-medium">Dark Mode</Label>
            <Switch
              id="theme-toggle"
              checked={theme === 'dark'}
              onCheckedChange={(checked) => handleThemeChange(checked ? 'dark' : 'light')}
              data-testid="theme-toggle"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI Keys</CardTitle>
          <CardDescription>Manage your API keys for external services.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="openrouter-key">OpenRouter API Key</Label>
            <div className="flex space-x-2">
              <Input
                id="openrouter-key"
                type="password"
                placeholder={openrouterKeyPresent ? '••••••••' : 'sk-or-...'}
                value={orKeyInput}
                onChange={(e) => setOrKeyInput(e.target.value)}
                data-testid="openrouter-key-input"
                className="flex-1"
              />
              <Button onClick={saveOpenRouterKey} disabled={!orKeyInput.trim()} data-testid="save-openrouter-key">
                Save
              </Button>
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="hf-token">HuggingFace Token</Label>
            <div className="flex space-x-2">
              <Input
                id="hf-token"
                type="password"
                placeholder={hfTokenPresent ? '••••••••' : 'hf_...'}
                value={hfTokenInput}
                onChange={(e) => setHfTokenInput(e.target.value)}
                data-testid="hf-token-input"
                className="flex-1"
              />
              <Button onClick={saveHfToken} disabled={!hfTokenInput.trim()} data-testid="save-hf-token">
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>Configure where your downloaded models are stored.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Models Directory</Label>
            <div className="flex items-center space-x-4">
              <p className="flex-1 bg-muted p-2 rounded-md text-sm font-mono truncate" data-testid="models-dir-display">
                {modelsDir || 'Not set'}
              </p>
              <Button variant="outline" onClick={changeModelsDir} data-testid="change-models-dir">
                Change
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Performance</CardTitle>
          <CardDescription>Adjust performance settings for your hardware.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="cpu-fallback" className="text-base font-medium">CPU Fallback</Label>
              <p className="text-sm text-muted-foreground">Force using CPU when GPU fails or is unsupported.</p>
            </div>
            <Switch
              id="cpu-fallback"
              checked={cpuFallback}
              onCheckedChange={handleCpuFallbackChange}
              data-testid="cpu-fallback-toggle"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
          <CardDescription>Information about AudioMorph Studio.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="font-semibold">Version:</span> <span data-testid="app-version">{version}</span>
          </p>
          <p className="text-muted-foreground">
            Created with ♥ by heartlib.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
          <CardDescription>Inspect local hardware compatibility and requirements.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/diagnostics"
            className="inline-flex items-center rounded-md border border-border bg-surface-2 px-3 py-2 text-sm font-medium text-text hover:bg-surface-3"
          >
            Open hardware diagnostics
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
