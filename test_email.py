#!/usr/bin/env python3
import os
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def test_email_config():
    # Get environment variables
    smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_username = os.getenv("SMTP_USERNAME")
    smtp_password = os.getenv("SMTP_PASSWORD")
    from_email = os.getenv("FROM_EMAIL", smtp_username)
    
    print(f"SMTP Server: {smtp_server}")
    print(f"SMTP Port: {smtp_port}")
    print(f"Username: {smtp_username}")
    print(f"Password: {'*' * len(smtp_password) if smtp_password else 'NOT SET'}")
    print(f"From Email: {from_email}")
    
    if not smtp_username or not smtp_password:
        print("ERROR: SMTP credentials not configured!")
        return False
    
    try:
        # Create message
        msg = MIMEMultipart('alternative')
        msg['Subject'] = "Test Email from Meeting Scheduler"
        msg['From'] = from_email
        msg['To'] = smtp_username  # Send to self for testing
        
        text_content = "This is a test email from the Meeting Scheduler application."
        html_content = f"""
        <html>
        <body>
            <h2>Test Email</h2>
            <p>This is a test email from the Meeting Scheduler application.</p>
            <p>If you receive this, the email configuration is working correctly!</p>
        </body>
        </html>
        """
        
        # Add text and HTML parts
        text_part = MIMEText(text_content, 'plain')
        msg.attach(text_part)
        
        html_part = MIMEText(html_content, 'html')
        msg.attach(html_part)
        
        # Create secure connection and send email
        context = ssl.create_default_context()
        with smtplib.SMTP(smtp_server, smtp_port) as server:
            print("Connecting to SMTP server...")
            server.starttls(context=context)
            print("Starting TLS...")
            server.login(smtp_username, smtp_password)
            print("Login successful!")
            server.send_message(msg)
            print("Email sent successfully!")
        
        return True
        
    except Exception as e:
        print(f"ERROR: Failed to send email: {str(e)}")
        return False

if __name__ == "__main__":
    test_email_config()

