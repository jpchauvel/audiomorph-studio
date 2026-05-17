'use client';

import { useState, useEffect, useRef } from 'react';
import { usePromptAssistStore } from '@/lib/stores/prompt-assist';
import { useGenerationStore } from '@/lib/stores/generation';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import Link from 'next/link';

// TODO(openrouter-ipc): SYSTEM_PROMPT, model selection, and streaming-token
// append (appendStream) are unused until the api:stream bridge supports
// POST bodies + the X-OpenRouter-Key header. Restore them with the IPC fix.

export function PromptAssistDrawer() {
  const {
    open,
    setOpen,
    messages,
    streaming,
    streamBuffer,
    addMessage,
    finalizeStream,
    reset: _reset,
  } = usePromptAssistStore();
  const { setPromptDraft, setLyricsDraft } = useGenerationStore();

  const [intent, setIntent] = useState('');
  const [keyPresent, setKeyPresent] = useState<boolean | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      window.electronAPI
        .request({ method: 'GET', path: '/settings' })
        .then((res: { status: number; body: unknown }) => {
          if (res.status >= 200 && res.status < 300) {
            const data = res.body as Record<string, unknown>;
            setKeyPresent(data.openrouter_key_present === 'true');
          } else {
            setKeyPresent(false);
          }
        })
        .catch(() => setKeyPresent(false));
    }
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamBuffer]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim() || streaming) return;

    const userMsg = intent.trim();
    setIntent('');
    addMessage({ role: 'user', content: userMsg });

    try {
      // TODO(openrouter-ipc): The sidecar expects the X-OpenRouter-Key header for this endpoint,
      // which api:request does not support, and api:stream is GET-only. We cannot call OpenRouter
      // via the sidecar without an IPC change.
      throw new Error(
        'OpenRouter streaming via sidecar is unsupported over the current IPC bridge',
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate response';
      toast.error(message);
      finalizeStream();
    }
  };

  const handleUsePrompt = (content: string) => {
    try {
      const jsonMatch =
        content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
      const rawJson = jsonMatch ? jsonMatch[1] : content;
      const parsed = JSON.parse(rawJson);
      if (parsed.prompt) setPromptDraft(parsed.prompt);
      toast.success('Prompt applied!');
      setOpen(false);
    } catch {
      toast.error('Could not parse JSON from response');
    }
  };

  const handleUseLyrics = (content: string) => {
    try {
      const jsonMatch =
        content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
      const rawJson = jsonMatch ? jsonMatch[1] : content;
      const parsed = JSON.parse(rawJson);
      if (parsed.lyrics) setLyricsDraft(parsed.lyrics);
      toast.success('Lyrics applied!');
      setOpen(false);
    } catch {
      toast.error('Could not parse JSON from response');
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="w-full sm:w-[480px] sm:max-w-md flex flex-col h-full bg-[var(--color-surface)] border-l-[var(--color-border)] p-0"
      >
        <div className="p-6 pb-4 border-b border-[var(--color-border)]">
          <SheetHeader>
            <SheetTitle className="text-[var(--color-text)]">Prompt Assist ✨</SheetTitle>
            <SheetDescription className="text-[var(--color-text-muted)]">
              Describe your idea, and AI will craft the perfect prompt and lyrics.
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="flex-1 overflow-y-auto p-6" ref={scrollRef}>
          {keyPresent === false && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Missing OpenRouter Key</AlertTitle>
              <AlertDescription>
                You need to set your OpenRouter API key in{' '}
                <Link href="/settings" className="underline">
                  Settings
                </Link>{' '}
                to use this feature.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`px-4 py-2 rounded-lg max-w-[85%] text-sm ${msg.role === 'user' ? 'bg-[var(--color-primary)] text-[var(--color-surface)]' : 'bg-[var(--color-surface-2)] text-[var(--color-text)] border border-[var(--color-border)]'}`}
                >
                  {msg.role === 'assistant' ? (
                    <div className="flex flex-col gap-3">
                      <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                      <div className="flex gap-2 w-full">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUsePrompt(msg.content)}
                          className="flex-1 text-xs"
                        >
                          Use this prompt
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUseLyrics(msg.content)}
                          className="flex-1 text-xs"
                        >
                          Use these lyrics
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                  )}
                </div>
              </div>
            ))}

            {streaming && (
              <div className="flex flex-col gap-1 items-start">
                <div className="px-4 py-2 rounded-lg max-w-[85%] text-sm bg-[var(--color-surface-2)] text-[var(--color-text)] border border-[var(--color-border)]">
                  <pre className="whitespace-pre-wrap font-sans">
                    {streamBuffer}
                    <span className="animate-pulse">_</span>
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]">
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="e.g., An upbeat synthwave track with a catchy bassline and lyrics about hacking the mainframe..."
              className="resize-none min-h-[80px] bg-[var(--color-surface)] border-[var(--color-border)] focus:border-[var(--color-primary)] text-sm"
              disabled={streaming || keyPresent === false}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-[var(--color-text-muted)]">Press Enter to send</span>
              <Button
                type="submit"
                disabled={!intent.trim() || streaming || keyPresent === false}
                size="sm"
                className="bg-[var(--color-primary)] text-[var(--color-surface)]"
              >
                Generate
              </Button>
            </div>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
