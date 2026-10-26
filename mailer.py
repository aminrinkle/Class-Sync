"""
Sends emails via Gmail SMTP. Used for:
- Absence alerts to parents (triggered from /api/attendance)
- Faculty complaints to parents (triggered from /api/complaint)

If sending fails (bad password, no internet, etc.), it prints the error
and returns False instead of crashing the request — a failed email
should never stop attendance from being saved.
"""

import smtplib
from email.mime.text import MIMEText

from config import SMTP_SERVER, SMTP_PORT, SENDER_EMAIL, SENDER_APP_PASSWORD, EMAIL_ENABLED


def send_email(to_email, subject, body):
    if not EMAIL_ENABLED:
        print(f"[EMAIL DISABLED] Would have sent to {to_email}: {subject}")
        return False

    try:
        msg = MIMEText(body)
        msg['Subject'] = subject
        msg['From'] = SENDER_EMAIL
        msg['To'] = to_email

        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(SENDER_EMAIL, SENDER_APP_PASSWORD)
            server.sendmail(SENDER_EMAIL, [to_email], msg.as_string())

        print(f"[EMAIL SENT] to {to_email}: {subject}")
        return True

    except Exception as e:
        print(f"[EMAIL FAILED] to {to_email}: {e}")
        return False


def send_absence_email(parent_email, student_name, subject_name, topic_name):
    subject = f"Attendance Alert — {student_name} was absent"
    body = (
        f"Dear Parent,\n\n"
        f"This is to inform you that {student_name} was marked absent today "
        f"in {subject_name}.\n"
        f"Topic covered: {topic_name or '(not specified)'}\n\n"
        f"— ClassSync, automated attendance system"
    )
    return send_email(parent_email, subject, body)


def send_complaint_email(parent_email, student_name, faculty_name, message):
    subject = f"Note from faculty — {student_name}"
    body = (
        f"Dear Parent,\n\n"
        f"{faculty_name} has sent the following note regarding {student_name}:\n\n"
        f"\"{message}\"\n\n"
        f"— ClassSync, automated notification system"
    )
    return send_email(parent_email, subject, body)