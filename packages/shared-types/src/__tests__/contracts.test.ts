import { describe, it, expect } from "vitest";
import {
  GenerationRequest,
  JobStatus,
  ExportFormat,
} from "../index";

describe("Type Contracts", () => {
  it("GenerationRequest has all 5 required fields", () => {
    const req: GenerationRequest = {
      prompt: "upbeat electronic",
      lyrics: "hello world",
      duration_seconds: 30,
      seed: 42,
      model_id: "heartmula-3b",
    };

    expect(req.prompt).toBeDefined();
    expect(req.lyrics).toBeDefined();
    expect(req.duration_seconds).toBeDefined();
    expect(req.seed).toBeDefined();
    expect(req.model_id).toBeDefined();
  });

  it("JobStatus has exactly 5 values", () => {
    const values = Object.values(JobStatus);
    expect(values).toHaveLength(5);
    expect(values).toContain("queued");
    expect(values).toContain("running");
    expect(values).toContain("completed");
    expect(values).toContain("failed");
    expect(values).toContain("cancelled");
  });

  it("ExportFormat has exactly 3 values", () => {
    const values = Object.values(ExportFormat);
    expect(values).toHaveLength(3);
    expect(values).toContain("wav");
    expect(values).toContain("mp3");
    expect(values).toContain("flac");
  });
});
