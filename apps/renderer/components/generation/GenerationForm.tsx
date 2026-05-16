'use client'

import { useState } from 'react'
import { useGenerationStore } from '@/lib/stores/generation'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { ShimmerButton } from '@/components/magicui/shimmer-button'
import { toast } from 'sonner'

type Model = {
  id: string
  name: string
}

type Props = {
  models: Model[]
  onSubmit: (data: any) => void
  onCancel: () => void
}

export function GenerationForm({ models, onSubmit, onCancel }: Props) {
  const { phase } = useGenerationStore()
  const isRunning = phase !== 'idle' && phase !== 'done' && phase !== 'error' && phase !== 'cancelled'
  
  const [prompt, setPrompt] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [modelId, setModelId] = useState(models[0]?.id || '')
  const [duration, setDuration] = useState(30)
  const [seed, setSeed] = useState('')
  
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [temperature, setTemperature] = useState(1.0)
  const [topK, setTopK] = useState(250)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!modelId) {
      toast.error('Please select a model first')
      return
    }
    if (isRunning) {
      toast.error('A generation is already in progress')
      return
    }
    onSubmit({
      prompt,
      lyrics: lyrics.trim() ? lyrics : undefined,
      model_id: modelId,
      duration_s: duration,
      seed: seed.trim() ? parseInt(seed, 10) : undefined,
      temperature,
      top_k: topK,
    })
  }

  const randomizeSeed = () => {
    setSeed(Math.floor(Math.random() * 2**31).toString())
  }

  const promptLength = prompt.length
  const isPromptTooLong = promptLength > 2000

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
      <div className="flex flex-col gap-2">
        <Label htmlFor="prompt">Prompt <span className="text-[var(--color-danger)]">*</span></Label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the music you want to generate..."
          className="min-h-[100px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm focus:border-[var(--color-primary)] outline-none resize-y"
          required
          maxLength={2000}
          disabled={isRunning}
        />
        <div className="flex justify-end">
          <span className={`text-xs ${isPromptTooLong || promptLength > 1800 ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'}`}>
            {promptLength}/2000
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <Label htmlFor="lyrics">Lyrics (Optional)</Label>
          <a href="#" className="text-xs text-[var(--color-primary)] hover:underline" onClick={(e) => { e.preventDefault(); toast.info('Lyrics workspace coming soon') }}>
            Insert from Lyrics Workspace
          </a>
        </div>
        <textarea
          id="lyrics"
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder="Add lyrics here..."
          className="min-h-[80px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm focus:border-[var(--color-primary)] outline-none resize-y"
          maxLength={4000}
          disabled={isRunning}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label>Model</Label>
          <Select 
            value={modelId} 
            onValueChange={(val) => { if (val) setModelId(val) }}
            disabled={isRunning || models.length === 0}
          >
            <SelectTrigger className="w-full h-10 border border-[var(--color-border)] bg-[var(--color-surface-2)]">
              <SelectValue placeholder={models.length > 0 ? "Select a model" : "No models available"} />
            </SelectTrigger>
            <SelectContent>
              {models.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex flex-col gap-2">
          <Label>Seed (Optional)</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="random"
              disabled={isRunning}
              className="border-[var(--color-border)] bg-[var(--color-surface-2)]"
            />
            <Button type="button" variant="outline" onClick={randomizeSeed} disabled={isRunning} aria-label="Randomize seed" className="px-3 border-[var(--color-border)]">
              🎲
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <Label>Duration: {duration}s</Label>
        </div>
        <Slider
          value={[duration]}
          onValueChange={(vals: any) => setDuration(Array.isArray(vals) ? vals[0] : vals)}
          min={1}
          max={240}
          step={1}
          disabled={isRunning}
          className="py-2"
        />
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
        <button
          type="button"
          className="w-full px-4 py-3 bg-[var(--color-surface-2)] text-sm font-medium text-left flex justify-between items-center"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          Advanced Settings
          <span className="text-[var(--color-text-muted)]">{showAdvanced ? '▲' : '▼'}</span>
        </button>
        
        {showAdvanced && (
          <div className="p-4 bg-[var(--color-surface)] border-t border-[var(--color-border)] flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <Label>Temperature: {temperature}</Label>
              <Slider
                value={[temperature]}
                onValueChange={(vals: any) => setTemperature(Array.isArray(vals) ? vals[0] : vals)}
                min={0.1}
                max={2.0}
                step={0.1}
                disabled={isRunning}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Top K</Label>
              <Input
                type="number"
                value={topK}
                onChange={(e) => setTopK(parseInt(e.target.value, 10))}
                min={1}
                disabled={isRunning}
                className="border-[var(--color-border)] bg-[var(--color-surface-2)]"
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        {isRunning ? (
          <ShimmerButton 
            onClick={(e) => { e.preventDefault(); onCancel() }} 
            type="button" 
            background="var(--color-danger)"
            className="w-full text-white font-semibold shadow-lg"
          >
            Cancel Generation
          </ShimmerButton>
        ) : (
          <Button 
            type="submit" 
            size="lg" 
            className="w-full bg-[var(--color-primary)] text-[var(--color-surface)] hover:opacity-90"
            disabled={models.length === 0 || isPromptTooLong || !prompt.trim()}
          >
            Generate
          </Button>
        )}
      </div>
    </form>
  )
}