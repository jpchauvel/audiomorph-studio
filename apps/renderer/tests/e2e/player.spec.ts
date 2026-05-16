import { test, expect } from '@playwright/test'

test.describe('Player Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('renders player after generation completes', async ({ page }) => {
    const input = page.getByPlaceholder('Describe the sound...')
    await input.fill('test sound')
    await page.getByRole('button', { name: /generate/i }).click()

    await expect(page.getByText('Generation complete')).toBeVisible({ timeout: 15000 })

    const player = page.getByTestId('waveform-player')
    await expect(player).toBeVisible()

    const playPauseBtn = page.getByTestId('play-pause-btn')
    await expect(playPauseBtn).toBeVisible()
    await expect(playPauseBtn).toHaveText('▶')
  })
})
