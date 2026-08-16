import { forwardRef, Module } from "@nestjs/common";
import { ClaimsModule } from "../claims/claims.module";
import { DatabaseModule } from "../database/database.module";
import { DocumentIntelligenceService } from "./document-intelligence.service";
import OpenAI from "openai";
import {
  OPENAI_CLIENT_FACTORY,
  OpenAiDocumentIntelligenceProvider
} from "./openai-document-intelligence.provider";
import { GeminiDocumentIntelligenceProvider } from "./gemini-document-intelligence.provider";

@Module({
  imports: [DatabaseModule, forwardRef(() => ClaimsModule)],
  providers: [
    DocumentIntelligenceService,
    {
      provide: OPENAI_CLIENT_FACTORY,
      useValue: (options: ConstructorParameters<typeof OpenAI>[0]) =>
        new OpenAI(options)
    },
    OpenAiDocumentIntelligenceProvider,
    GeminiDocumentIntelligenceProvider
  ],
  exports: [DocumentIntelligenceService]
})
export class DocumentIntelligenceModule {}
