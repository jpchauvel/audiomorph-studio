'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { useModelsStore, ModelInfo, DownloadProgress } from '@/lib/stores/models'

const API_BASE = () => (typeof window !== 'undefined' && (window as any).__AUDIOMORPH_API_BASE__) || 'http://localhost:8000'
const TOKEN = () => (typeof window !== 'undefined' && (window as any).__AUDIOMORPH_TOKEN__) || ''
const headers = () => ({ 'X-Audiomorph-Token': TOKEN() })

export default function ModelsPage() {
  const { models, progress, setModels, setProgress, clearProgress } = useModelsStore()
  const [activeDownloads, setActiveDownloads] = useState<Record<string, EventSource>>({})

  const fetchModels = async () => {
    try {
      const res = await fetch(`${API_BASE()}/models`, { headers: headers() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setModels(data)
    } catch (e: any) {
      toast.error('Failed to fetch models: ' + e.message)
    }
  }

  useEffect(() => {
    fetchModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const anyDownloading = Object.values(progress).some(p => p.state === 'downloading')

  const startDownload = async (model: ModelInfo) => {
    try {
      const res = await fetch(`${API_BASE()}/models/${model.id}/download`, {
        method: 'POST',
        headers: headers()
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { job_id } = await res.json()

      setProgress(model.id, {
        jobId: job_id,
        bytesDone: 0,
        totalBytes: 100, // placeholder until first event
        speedMbps: 0,
        currentFile: '',
        state: 'downloading'
      })

      const es = new EventSource(`${API_BASE()}/models/jobs/${job_id}/events?token=${TOKEN()}`)
      
      es.addEventListener('progress', (e: Event) => {
        const messageEvent = e as MessageEvent;
        const data = JSON.parse(messageEvent.data)
        setProgress(model.id, {
          bytesDone: data.bytes_done,
          totalBytes: data.total_bytes,
          speedMbps: data.speed_mbps,
          currentFile: data.current_file
        })
      })

      es.addEventListener('done', () => {
        es.close()
        setProgress(model.id, { state: 'done' })
        setActiveDownloads(prev => { const n = {...prev}; delete n[model.id]; return n })
        toast.success(`Downloaded ${model.name}`)
        fetchModels()
      })

      es.addEventListener('error', (e: Event) => {
        es.close()
        const messageEvent = e as MessageEvent;
        const data = JSON.parse(messageEvent.data)
        setProgress(model.id, { state: 'error', error: data.error })
        setActiveDownloads(prev => { const n = {...prev}; delete n[model.id]; return n })
        toast.error(`Download failed: ${data.error}`)
        fetchModels()
      })

      setActiveDownloads(prev => ({ ...prev, [model.id]: es }))
    } catch (e: any) {
      toast.error('Failed to start download: ' + e.message)
    }
  }

  const cancelDownload = async (modelId: string) => {
    const job = progress[modelId]
    if (!job || job.state !== 'downloading') return

    try {
      await fetch(`${API_BASE()}/models/jobs/${job.jobId}`, {
        method: 'DELETE',
        headers: headers()
      })
      const es = activeDownloads[modelId]
      if (es) {
        es.close()
        setActiveDownloads(prev => { const n = {...prev}; delete n[modelId]; return n })
      }
      setProgress(modelId, { state: 'cancelled' })
      toast.info('Download cancelled')
      fetchModels()
    } catch (e: any) {
      toast.error('Failed to cancel download: ' + e.message)
    }
  }

  const verifyModel = async (model: ModelInfo) => {
    try {
      const res = await fetch(`${API_BASE()}/models/${model.id}/verify`, {
        method: 'POST',
        headers: headers()
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result = await res.json()
      
      if (result.valid) {
        toast.success(`${model.name} is fully verified`)
      } else {
        toast.error(`${model.name} has ${result.mismatches.length} corrupted files`)
      }
      fetchModels()
    } catch (e: any) {
      toast.error('Failed to verify model: ' + e.message)
    }
  }

  const deleteModel = async (model: ModelInfo) => {
    try {
      const res = await fetch(`${API_BASE()}/models/${model.id}`, {
        method: 'DELETE',
        headers: headers()
      })
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`)
      toast.success(`Deleted ${model.name}`)
      fetchModels()
    } catch (e: any) {
      toast.error('Failed to delete model: ' + e.message)
    }
  }

  const getBadgeProps = (state: string) => {
    switch (state) {
      case 'missing': return { variant: 'outline' as const, style: { borderColor: 'var(--color-text-muted)', color: 'var(--color-text-muted)' } }
      case 'downloading': return { variant: 'default' as const, style: { backgroundColor: 'var(--color-primary)' } }
      case 'verified': return { variant: 'default' as const, style: { backgroundColor: 'var(--color-success)' } }
      case 'partial': return { variant: 'default' as const, style: { backgroundColor: 'var(--color-warning)', color: 'var(--color-text-base)' } }
      case 'corrupted': return { variant: 'destructive' as const, style: { backgroundColor: 'var(--color-danger)' } }
      default: return { variant: 'outline' as const }
    }
  }

  return (
    <div className="container mx-auto py-10 max-w-5xl">
      {/* AUDIOMORPH_TEST_MODE hook */}
      <span hidden data-testid="route-ready" />
      <h1 className="text-3xl font-bold mb-8">Model Library</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {models.map(model => {
          const dl = progress[model.id]
          const isDownloading = dl?.state === 'downloading'
          const pct = isDownloading && dl.totalBytes > 0 ? (dl.bytesDone / dl.totalBytes) * 100 : 0
          
          return (
            <Card key={model.id} className="flex flex-col">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="mb-2">{model.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">{model.repo_id}</CardDescription>
                  </div>
                  <Badge {...getBadgeProps(model.state)}>{model.state}</Badge>
                </div>
              </CardHeader>
              
              <CardContent className="flex-grow">
                <div className="text-sm mb-4">Size: {model.size_gb.toFixed(2)} GB</div>
                
                {isDownloading && (
                  <div className="space-y-3 bg-surface p-4 rounded-md border border-border">
                    <div className="flex justify-between text-sm font-medium">
                      <span>Downloading...</span>
                      <span>
                        <NumberTicker value={dl.speedMbps} /> Mbps
                      </span>
                    </div>
                    <Progress value={pct} className="h-2" />
                    <div className="flex justify-between text-xs text-text-muted font-mono truncate">
                      <span className="truncate mr-4">{dl.currentFile || 'Connecting...'}</span>
                      <span className="whitespace-nowrap">
                        <NumberTicker value={dl.bytesDone} /> / <NumberTicker value={dl.totalBytes} /> bytes
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
              
              <CardFooter className="flex justify-end gap-2 border-t pt-4">
                {isDownloading ? (
                  <Button variant="destructive" size="sm" onClick={() => cancelDownload(model.id)}>
                    Cancel
                  </Button>
                ) : (
                  <>
                    {(model.state === 'missing' || model.state === 'partial' || model.state === 'corrupted') && (
                      <Button 
                        variant="default" 
                        size="sm" 
                        onClick={() => startDownload(model)}
                        disabled={anyDownloading}
                      >
                        Download
                      </Button>
                    )}
                    
                    {model.state !== 'missing' && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => verifyModel(model)}>
                          Verify
                        </Button>
                        
                        <AlertDialog>
                          <AlertDialogTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 h-8 px-3 text-xs">
                            Delete
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {model.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently remove the model files from your disk.
                                You will need to download it again to use it.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => deleteModel(model)}
                                className="bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger)]/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </>
                )}
              </CardFooter>
            </Card>
          )
        })}
      </div>
      
      {models.length === 0 && (
        <div className="text-center py-20 text-text-muted">
          No models available.
        </div>
      )}
    </div>
  )
}
