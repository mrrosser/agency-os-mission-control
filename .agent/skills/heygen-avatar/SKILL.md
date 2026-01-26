---
name: HeyGen Avatar Videos
description: Create personalized avatar videos for leads using HeyGen API
---

# HeyGen Avatar Videos Skill

## Overview

This skill enables you to create AI-generated avatar videos with personalized scripts for lead outreach. Perfect for creating scalable, personalized video content.

## Prerequisites

- HeyGen API key (configured in Mission Control API Vault)
- Video scripts prepared
- Avatar and voice selections

## Usage

### Create Avatar Video

```typescript
// Load HeyGen credentials
const config = JSON.parse(localStorage.getItem("mission_control_secrets") || "{}");

// Step 1: Create video
const createResponse = await fetch('/api/heygen/create-avatar', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    heyGenKey: config.heyGenKey,
    script: 'Hi John, I wanted to personally reach out about your lead generation...',
    avatarId: 'default_avatar',  // Optional
    voiceId: 'en-US-Neural2-J'   // Optional
  })
});

const createResult = await createResponse.json();
console.log('Video ID:', createResult.videoId);

// Step 2: Poll for completion
const checkStatus = async (videoId: string) => {
  const statusResponse = await fetch('/api/heygen/get-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      heyGenKey: config.heyGenKey,
      videoId: videoId
    })
  });
  
  const statusResult = await statusResponse.json();
  
  if (statusResult.status === 'completed') {
    console.log('Video ready:', statusResult.videoUrl);
    return statusResult.videoUrl;
  } else {
    console.log('Status:', statusResult.status);
    // Poll again in 10 seconds
    setTimeout(() => checkStatus(videoId), 10000);
  }
};

checkStatus(createResult.videoId);
```

### Generate Personalized Video for Lead

```typescript
const generateAvatarForLead = async (lead: any) => {
  const config = JSON.parse(localStorage.getItem("mission_control_secrets") || "{}");
  
  const personalizedScript = `Hi ${lead.name}, 

I'm Marcus from Lead Generation Solutions. 

I noticed ${lead.company} and wanted to personally introduce myself through this quick video.

We help businesses like yours generate qualified leads on autopilot using Google Workspace automation.

Here's what makes us different:

First, we integrate directly with your existing tools - Calendar, Gmail, and Drive.

Second, we create personalized outreach at scale, just like this video.

And third, we help you track everything in real-time.

I'd love to show you how we've helped companies similar to ${lead.company} increase their pipeline by 300%.

Check your email for my calendar link, or reply directly and let's set up a 15-minute chat.

Looking forward to connecting!`;

  // Create video
  const response = await fetch('/api/heygen/create-avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      heyGenKey: config.heyGenKey,
      script: personalizedScript,
    })
  });

  const result = await response.json();
  return result.videoId;
};
```

## Script Templates

### Cold Outreach Video
```
Hi {{name}}, 

I'm {{yourName}} from {{yourCompany}}.

I noticed {{company}} and wanted to personally reach out through this video.

We help businesses like yours {{valueProposition}}.

Here's what makes us different:
[List 3 unique benefits]

I'd love to show you {{specificResult}}.

Check your email for my calendar link!
```

### Product Demo
```
{{name}}, 

Thanks for your interest! 

Let me walk you through {{productName}}.

[Demo key features]

This solves {{painPoint}} for {{company}}.

Ready to get started? Book a call with my team.
```

### Follow-Up Video
```
Hey {{name}}, 

Following up on my previous message about {{topic}}.

Quick recap of how we help:
[3 bullet points]

Still interested in {{outcome}}?

Let's connect soon!
```

## API Reference

### Endpoint: `/api/heygen/create-avatar`

**Request:**
```typescript
{
  heyGenKey: string,      // HeyGen API key
  script: string,         // Video script
  avatarId?: string,      // Optional avatar selection
  voiceId?: string        // Optional voice selection
}
```

**Response (Success):**
```typescript
{
  success: true,
  videoId: string,        // Use this to check status
  status: 'processing',
  message: string
}
```

### Endpoint: `/api/heygen/get-status`

**Request:**
```typescript
{
  heyGenKey: string,
  videoId: string
}
```

**Response:**
```typescript
{
  success: true,
  videoId: string,
  status: 'processing' | 'completed' | 'failed',
  videoUrl?: string,      // Available when completed
  thumbnailUrl?: string,
  duration?: number
}
```

## Video Status Workflow

```typescript
const waitForVideo = async (videoId: string): Promise<string> => {
  const config = JSON.parse(localStorage.getItem("mission_control_secrets") || "{}");
  
  while (true) {
    const response = await fetch('/api/heygen/get-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        heyGenKey: config.heyGenKey,
        videoId: videoId
      })
    });
    
    const result = await response.json();
    
    if (result.status === 'completed') {
      return result.videoUrl;
    } else if (result.status === 'failed') {
      throw new Error('Video generation failed');
    }
    
    // Wait 10 seconds before checking again
    await new Promise(r => setTimeout(r, 10000));
  }
};
```

## Best Practices

1. **Script Length**: Keep videos under 90 seconds (ideal: 30-45 seconds)
2. **Natural Language**: Write conversationally, not formally
3. **Personalization**: Include name, company, specific pain points
4. **Call-to-Action**: Clear next step at the end
5. **Visual Context**: Mention "this video" to acknowledge the medium
6. **Processing Time**: Videos take 2-5 minutes to generate

## Integration with Email Campaigns

```typescript
const sendVideoEmail = async (lead: any) => {
  // 1. Generate video
  const videoId = await generateAvatarForLead(lead);
  
  // 2. Wait for completion
  const videoUrl = await waitForVideo(videoId);
  
  // 3. Send email with video link
  await fetch('/api/gmail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: lead.email,
      subject: `Personal video for ${lead.name} at ${lead.company}`,
      body: `
        <h2>Hi ${lead.name},</h2>
        <p>I created a personalized video just for you:</p>
        <p><a href="${videoUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;">Watch My Video Message</a></p>
        <p>Looking forward to connecting!</p>
        <p>- Marcus</p>
      `
    })
  });
};
```

## Complete Campaign Workflow

```typescript
const runVideoOutreachCampaign = async (leads: any[]) => {
  for (const lead of leads) {
    try {
      console.log(`Creating video for ${lead.name}...`);
      
      // 1. Generate personalized avatar video
      const videoId = await generateAvatarForLead(lead);
      
      // 2. Wait for video to complete (non-blocking)
      waitForVideo(videoId).then(async (videoUrl) => {
        // 3. Send email with video link
        await sendVideoEmail(lead, videoUrl);
        
        console.log(`✓ Video sent to ${lead.name}`);
      });
      
      // Don't wait - move to next lead
      // Videos process in parallel
      
    } catch (error) {
      console.error(`Failed for ${lead.name}:`, error);
    }
    
    // Rate limiting between video creations
    await new Promise(r => setTimeout(r, 5000));
  }
};
```

## Tips

- Test with one video before batch processing
- Monitor video generation queue (limit concurrent requests)
- Save video URLs for later reuse
- Use video thumbnails in email previews
- Track video views with UTM parameters
- Download important videos for local storage

## Cost Estimation

HeyGen pricing (approximate):
- Free trial: 1 minute of credit
- Creator: $29/month, 15 minutes
- Business: $149/month, 90 minutes

Average outreach video: 30-45 seconds
- Creator plan: ~20-30 videos/month
- Business plan: ~120-180 videos/month

## Advanced Features

### Custom Backgrounds
```typescript
{
  video_inputs: [{
    background: {
      type: 'color',
      value: '#ffffff'
    },
    // ... rest of config
  }]
}
```

### Multiple Scenes
```typescript
// Create video with different scenes
{
  video_inputs: [
    {
      character: { avatar_id: 'avatar1' },
      voice: { input_text: 'Scene 1 script' }
    },
    {
      character: { avatar_id: 'avatar2' },
      voice: { input_text: 'Scene 2 script' }
    }
  ]
}
```
