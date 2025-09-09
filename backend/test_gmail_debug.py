#!/usr/bin/env python3
import os
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def debug_gmail_connection():
    # Get environment variables
    smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_username = os.getenv("SMTP_USERNAME")
    smtp_password = os.getenv("SMTP_PASSWORD")
    from_email = os.getenv("FROM_EMAIL", smtp_username)
    
    print("=== Gmail SMTP Debug Information ===")
    print(f"SMTP Server: {smtp_server}")
    print(f"SMTP Port: {smtp_port}")
    print(f"Username: {smtp_username}")
    print(f"Password Length: {len(smtp_password) if smtp_password else 0}")
    print(f"From Email: {from_email}")
    print()
    
    if not smtp_username or not smtp_password:
        print("ERROR: SMTP credentials not configured!")
        return False
    
    try:
        print("Step 1: Creating SMTP connection...")
        server = smtplib.SMTP(smtp_server, smtp_port)
        print("✓ SMTP connection created")
        
        print("Step 2: Starting TLS...")
        context = ssl.create_default_context()
        server.starttls(context=context)
        print("✓ TLS started")
        
        print("Step 3: Attempting login...")
        server.login(smtp_username, smtp_password)
        print("✓ Login successful!")
        
        print("Step 4: Creating test message...")
        msg = MIMEMultipart('alternative')
        msg['Subject'] = "Test Email from Meeting Scheduler"
        msg['From'] = from_email
        msg['To'] = smtp_username
        
        text_content = "This is a test email from the Meeting Scheduler application."
        html_content = "<html><body><h2>Test Email</h2><p>Email configuration is working!</p></body></html>"
        
        text_part = MIMEText(text_content, 'plain')
        msg.attach(text_part)
        html_part = MIMEText(html_content, 'html')
        msg.attach(html_part)
        
        print("Step 5: Sending email...")
        server.send_message(msg)
        print("✓ Email sent successfully!")
        
        print("Step 6: Closing connection...")
        server.quit()
        print("✓ Connection closed")
        
        print("\n🎉 SUCCESS: Email configuration is working correctly!")
        return True
        
    except smtplib.SMTPAuthenticationError as e:
        print(f"\n❌ AUTHENTICATION ERROR: {e}")
        print("\nPossible solutions:")
        print("1. Make sure 2-Step Verification is enabled on your Google account")
        print("2. Generate a new App Password from: https://myaccount.google.com/apppasswords")
        print("3. Make sure you're using the App Password, not your regular Gmail password")
        print("4. Check if your Google account has any security restrictions")
        return False
        
    except smtplib.SMTPException as e:
        print(f"\n❌ SMTP ERROR: {e}")
        return False
        
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        return False

if __name__ == "__main__":
    debug_gmail_connection()

