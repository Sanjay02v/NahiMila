import type { SeedDataPayload } from '@/lib/db/store';
import type { QuoteEvaluation,NoShowAnalysis } from '@/types';
export type WorkspaceData=SeedDataPayload & {evaluations:QuoteEvaluation[];analyses:NoShowAnalysis[];storageMode:string;voiceAvailable:boolean};
