---
name: ElevenLabs Voice Generator
description: Generate voice messages for outreach using ElevenLabs text-to-speech API
---

# ElevenLabs Voice Generator Skill

## Overview

This skill enables you to convert text into professional voice audio using ElevenLabs AI voice synthesis. Perfect for creating personalized voice messages for outreach campaigns.

## Prerequisites

- ElevenLabs API key (configured in Mission Control API Vault)
- Text scripts for voice generation

## Usage

### Basic Voice Generation

```typescript
// Load ElevenLabs credentials
const config = JSON.parse(localStorage.getItem("mission_control_secrets") || "{}");

// Generate voice audio
const response = await fetch('/api/elevenlabs/synthesize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    elevenLabsKey: config.elevenLabsKey,
    text: 'Hi John, this is Marcus reaching out about lead generation...',
    voiceId: '21m00Tcm4TlvDq8ikWAM', // Optional: Rachel voice
  })
});

const result = await response.json();

// Audio is returned as base64
const audioData = result.audioBase64;
const audioBlob = new Blob(
  [Uint8Array.from(atob(audioData), c => c.charCodeAt(0))],
  { type: 'audio/mpeg' }
);

// Download or play audio
const audioUrl = URL.createObjectURL(audioBlob);
const audio = new Audio(audioUrl);
audio.play();
```

### Generate Voice for Lead Campaign

```typescript
// Generate personalized voice messages for leads
const generateVoiceForLead = async (lead: any) => {
  const config = JSON.parse(localStorage.getItem("mission_control_secrets") || "{}");
  
  const script = `Hi ${lead.name}, 

This is Marcus from Lead Generation Solutions. 

I noticed ${lead.company} and wanted to personally reach out about how we help businesses like yours generate qualified leads on autopilot.

I'd love to chat for 15 minutes about your current lead generation process and show you how we've helped similar companies increase their pipeline by 300%.

Check your email for my calendar link. Looking forward to connecting!`;

  const response = await fetch('/api/elevenlabs/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      elevenLabsKey: config.elevenLabsKey,
      text: script,
      voiceId: '21m00Tcm4TlvDq8ikWAM', // Professional female voice
    })
  });

  const result = await response.json();
  
  // Save audio file
  const audioBlob = new Blob(
    [Uint8Array.from(atob(result.audioBase64), c => c.charCodeAt(0))],
    { type: 'audio/mpeg' }
  );
  
  return audioBlob;
};
```

## Voice Options

### Available Voices (Popular)

| Voice ID | Name | Description |
|----------|------|-------------|
| `21m00Tcm4TlvDq8ikWAM` | Rachel | Professional, clear female voice |
| `EXAVITQu4vr4xnSDxMaL` | Sarah | Warm, friendly female voice |
| `pNInz6obpgDQGcFmaJgB` | Adam | Professional male voice |
| `yoZ06aMxZJJ28mfd3POQ` | Sam | Conversational male voice |

To get full list of voices:
```bash
curl https://api.elevenlabs.io/v1/voices \
  -H "xi-api-key: YOUR_API_KEY"
```

## Script Templates

### Cold Outreach Voice Message
```
Hi {{name}}, 

This is {{yourName}} from {{yourCompany}}. 

I help companies like {{company}} {{valueProposition}}.

I sent you an email with more details, but wanted to personally reach out because {{reason}}.

Would love to chat for 15 minutes about {{topic}}.

Check your email for my calendar link!
```

### Follow-Up Voice Message
```
{{name}}, this is {{yourName}} following up on my email about {{topic}}.

Quick question: Is {{painPoint}} still a challenge for {{company}}?

I have a few ideas that could help. Let's connect soon!
```

### Thank You Message
```
Hey {{name}}, 

Just wanted to say thanks for taking the time to chat today.

As promised, I'm sending over {{resource}} that should help with {{challenge}}.

Looking forward to our next steps!
```

## API Reference

### Endpoint: `/api/elevenlabs/synthesize`

**Request:**
```typescript
{
  elevenLabsKey: string,  // ElevenLabs API key
  text: string,           // Text to synthesize (max 5000 chars)
  voiceId?: string,       // Optional voice ID
  modelId?: string        // Optional model ID
}
```

**Response (Success):**
```typescript
{
  success: true,
  audioBase64: string,    // Base64 encoded MP3 audio
  mimeType: 'audio/mpeg',
  voiceId: string
}
```

**Response (Error):**
```typescript
{
  success: false,
  error: string
}
```

## Best Practices

1. **Script Length**: Keep under 300 words for optimal quality
2. **Natural Language**: Write as you would speak, not as you would write
3. **Pauses**: Use commas and periods for natural pacing
4. **Personalization**: Include lead's name and company
5. **Call-to-Action**: Clear next step at the end
6. **Test Voices**: Try 2-3 voices to find best fit for your brand

## Integration with Email Campaigns

```typescript
// Attach voice message to email
const sendEmailWithVoice = async (lead: any) => {
  // 1. Generate voice message
  const audioBlob = await generateVoiceForLead(lead);
  
  // 2. Convert to base64 for email attachment
  const reader = new FileReader();
  reader.readAsDataURL(audioBlob);
  reader.onloadend = async () => {
    const base64Audio = reader.result as string;
    
    // 3. Send email with audio attachment
    await fetch('/api/gmail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: lead.email,
        subject: `Personal message for ${lead.name}`,
        body: `Hi ${lead.name}, I recorded a quick voice message for you...`,
        attachments: [{
          filename: 'voice-message.mp3',
          content: base64Audio.split(',')[1],
          type: 'audio/mpeg'
        }]
      })
    });
  };
};
```

## Tips

- Use SSML tags for advanced control (emphasis, breaks)
- Preview with short test before generating full campaign
- Save generated audio files for reuse
- Combine with video avatars (HeyGen) for visual + audio
- Monitor API usage (ElevenLabs charges per character)

## Advanced: Voice Cloning

If you have ElevenLabs Pro:
1. Upload voice samples (at least 30 seconds)
2. Train custom voice
3. Use custom voice ID in requests

## Cost Estimation

ElevenLabs pricing (approximate):
- Free tier: 10,000 characters/month
- Starter: $5/month, 30,000 characters
- Creator: $22/month, 100,000 characters

Average campaign message: ~500 characters = 200 voice messages per month on Creator plan
