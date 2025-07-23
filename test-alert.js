require('dotenv').config();
const nodemailer = require("nodemailer");

async function sendAlert(subject, message) {
    // Log to console for immediate visibility
    console.error(`ALERT: ${subject} - ${message}`);

    // Send email alert if SMTP is configured
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.ALERT_EMAIL_TO) {
        try {
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT) || 587,
                secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASSWORD,
                },
            });

            const mailOptions = {
                from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER,
                to: process.env.ALERT_EMAIL_TO,
                subject: `CDR System Alert: ${subject}`,
                text: `CDR Processing Alert\n\nSubject: ${subject}\n\nDetails:\n${message}\n\nTimestamp: ${new Date().toISOString()}\n\nThis is an automated alert from the VoIP Innovations CDR processing system.`,
                html: `
          <h2>CDR Processing Alert</h2>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Details:</strong></p>
          <pre>${message}</pre>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          <hr>
          <p><em>This is an automated alert from the VoIP Innovations CDR processing system.</em></p>
        `
            };

            await transporter.sendMail(mailOptions);
            console.log(`Alert email sent successfully to ${process.env.ALERT_EMAIL_TO}`);

        } catch (emailError) {
            console.error('Failed to send alert email:', emailError.message);
        }
    } else {
        console.warn('SMTP not configured - alert email not sent');
        console.log('Required env vars:');
        console.log('SMTP_HOST:', process.env.SMTP_HOST ? 'SET' : 'MISSING');
        console.log('SMTP_USER:', process.env.SMTP_USER ? 'SET' : 'MISSING');
        console.log('ALERT_EMAIL_TO:', process.env.ALERT_EMAIL_TO ? 'SET' : 'MISSING');
    }
}

// Test the alert function
async function testAlert() {
    console.log('Testing alert system...');
    await sendAlert("Test Alert", "This is a test message to verify SMTP alerting is working correctly.");
    console.log('Test completed.');
}

testAlert().catch(console.error);