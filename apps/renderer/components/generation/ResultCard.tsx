'use client'

import { useGenerationStore } from '@/lib/stores/generation'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function ResultCard() {
  const { phase, resultJobId } = useGenerationStore()

  if (phase !== 'done' || !resultJobId) return null

  return (
    <Card className="mt-6 border border-[var(--color-success)] bg-[var(--color-success)]/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-[var(--color-success)] flex items-center gap-2">
          <span>✓</span> Generation complete
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">Job ID</span>
          <code className="text-sm px-2 py-1 rounded bg-[var(--color-surface-3)] text-[var(--color-text)]">
            {resultJobId}
          </code>
        </div>
        
        <Button variant="default" className="w-full" onClick={() => console.log('Play', resultJobId)}>
          Play
        </Button>
      </CardContent>
    </Card>
  )
}