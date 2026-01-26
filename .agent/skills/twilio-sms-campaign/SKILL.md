---
name: Twilio SMS Campaign
description: Send SMS messages to leads using Twilio API with personalized templates
---

# Twilio SMS Campaign Skill

## Overview

This skill enables you to send SMS messages to leads using the Twilio API. It supports personalized message templates, batch sending, and delivery tracking.

## Prerequisites

- Twilio Account SID and Auth Token (configured in Mission Control API Vault)
- Twilio phone number for sending messages
- Lead list with phone numbers

## Usage

### Basic SMS Send

```typescript
// Load Twilio credentials from API Vault
const config = JSON.parse(localStorage.getItem("mission_control_secrets") || "{}");

// Send single SMS
const response = await fetch('/api/twilio/send-sms', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    twilioSid: config.twilioSid,
    twilioToken: config.twilioToken,
    to: '+15551234567',
    from: '+15559876543', // Your Twilio number
    message: 'Hi John, quick question about your lead generation...'
  })
});

const result = await response.json();
console.log('SMS sent:', result.messageSid);
```

### Personalized Campaign

```typescript
// Example: Send to multiple leads with personalization
const leads = [
  { name: 'John Doe', phone: '+15551111111', company: 'Acme Inc' },
  { name: 'Jane Smith', phone: '+15552222222', company: 'Tech Corp' }
];

for (const lead of leads) {
  const personalizedMessage = `Hi ${lead.name}, 

I noticed ${lead.company} and wanted to reach out about your lead generation strategy.

Quick question: Are you currently using any automation for outreach?

- Marcus`;

  await fetch('/api/twilio/send-sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      twilioSid: config.twilioSid,
      twilioToken: config.twilioToken,
      to: lead.phone,
      from: config.twilioNumber,
      message: personalizedMessage
    })
  });

  // Rate limiting: wait 2 seconds between messages
  await new Promise(r => setTimeout(r, 2000));
}
```

## Template Examples

### Cold Outreach
```
Hi {{name}}, 

I help companies like {{company}} generate qualified leads on autopilot.

Would you be open to a quick 15-min chat about your current lead gen process?

- {{yourName}}
```

### Follow-Up
```
{{name}}, following up on my email about {{topic}}.

Quick question: Is this still a priority for {{company}}?

Let me know if you'd like to chat.
```

### Meeting Reminder
```
Hi {{name}}, 

Quick reminder about our call today at {{time}}.

Join here: {{meetLink}}

Looking forward to it!
```

## API Reference

### Endpoint: `/api/twilio/send-sms`

**Request:**
```typescript
{
  twilioSid: string,      // Twilio Account SID
  twilioToken: string,    // Twilio Auth Token
  to: string,             // Recipient phone (E.164 format)
  from?: string,          // Your Twilio number (optional)
  message: string         // SMS content (max 1600 chars)
}
```

**Response (Success):**
```typescript
{
  success: true,
  messageSid: string,     // Twilio message ID
  status: string,         // 'queued', 'sent', etc.
  to: string,
  from: string
}
```

**Response (Error):**
```typescript
{
  success: false,
  error: string,
  code: string
}
```

## Best Practices

1. **Phone Number Format**: Always use E.164 format (`+1555123456`)
2. **Message Length**: Keep under 160 chars for single SMS
3. **Rate Limiting**: Wait 1-2 seconds between messages
4. **Compliance**: Include opt-out language and company name
5. **Timing**: Send during business hours (9 AM - 5 PM local time)
6. **Personalization**: Use lead name and company for better engagement

## Error Handling

```typescript
try {
  const response = await fetch('/api/twilio/send-sms', { ... });
  const result = await response.json();
  
  if (!result.success) {
    console.error('SMS failed:', result.error);
    // Handle specific error codes
    if (result.code === '21211') {
      console.log('Invalid phone number');
    }
  }
} catch (error) {
  console.error('Network error:', error);
}
```

## Common Error Codes

- **21211**: Invalid phone number
- **21408**: Permission denied (wrong credentials)
- **21610**: Unsubscribed recipient
- **30007**: Message flagged as spam

## Integration with Operations

```typescript
// In Operations campaign workflow
const sendSMSToLead = async (lead: any) => {
  const config = JSON.parse(localStorage.getItem("mission_control_secrets") || "{}");
  
  await fetch('/api/twilio/send-sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      twilioSid: config.twilioSid,
      twilioToken: config.twilioToken,
      to: lead.phone,
      message: `Hi ${lead.name}, quick question about ${lead.company}...`
    })
  });
};
```

## Tips

- Test with your own phone number first
- Use URL shorteners for links in SMS
- Track responses manually or use Twilio webhooks
- Consider SMS sequences (initial message → follow-up)
- Combine with email campaigns for multi-channel outreach
