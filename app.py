"""
ClassSync backend — Flask app.

Run: python app.py
Then open http://127.0.0.1:5000 in your browser.
"""

from flask import Flask, request, jsonify, session, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash
from datetime import datetime
import os
import re

from database import get_connection
from mailer import send_absence_email, send_complaint_email

app = Flask(__name__, static_folder=None)
app.secret_key = 'classsync-dev-secret-change-this-later'  # fine for a mini project

# Folder where your frontend files (index.html, faculty.html, css/, js/...) live.
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'ClassSync')


# ---------------------------------------------------------------
# Serve the frontend (so everything runs from one Flask server)
# ---------------------------------------------------------------

@app.route('/')
def serve_index():
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/<path:filename>')
def serve_frontend_file(filename):
    return send_from_directory(FRONTEND_DIR, filename)


# ---------------------------------------------------------------
# Auth
# ---------------------------------------------------------------

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json(force=True)
    identifier = (data.get('email') or '').strip()
    password = data.get('password') or ''
    role = data.get('role')

    conn = get_connection()

    if role == 'student':
        # Students can log in with their Roll No OR their email address.
        user = conn.execute(
            '''SELECT u.* FROM users u
               JOIN students s ON s.user_id = u.id
               WHERE (s.roll_no = ? OR u.email = ?) AND u.role = 'student' ''',
            (identifier, identifier.lower()),
        ).fetchone()
    else:
        user = conn.execute(
            'SELECT * FROM users WHERE email = ? AND role = ?', (identifier.lower(), role)
        ).fetchone()

    conn.close()

    if not user or not check_password_hash(user['password'], password):
        return jsonify({'error': 'Invalid credentials for this role'}), 401

    session['user_id'] = user['id']
    session['role'] = user['role']
    session['name'] = user['name']

    return jsonify({'id': user['id'], 'name': user['name'], 'role': user['role']})


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/me')
def me():
    if 'user_id' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    return jsonify({'id': session['user_id'], 'name': session['name'], 'role': session['role']})


# ---------------------------------------------------------------
# Subjects & syllabus topics
# ---------------------------------------------------------------

@app.route('/api/subjects')
def get_subjects():
    conn = get_connection()
    rows = conn.execute('SELECT id, name FROM subjects ORDER BY id').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/topics')
def get_topics():
    subject_id = request.args.get('subject_id')
    conn = get_connection()
    rows = conn.execute(
        'SELECT id, topic_name FROM syllabus_topics WHERE subject_id = ? ORDER BY id',
        (subject_id,),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/topics', methods=['POST'])
def add_topic():
    data = request.get_json(force=True)
    subject_id = data.get('subject_id')
    topic_name = (data.get('topic_name') or '').strip()

    if not subject_id or not topic_name:
        return jsonify({'error': 'subject_id and topic_name are required'}), 400

    conn = get_connection()
    cur = conn.execute(
        'INSERT INTO syllabus_topics (subject_id, topic_name) VALUES (?, ?)',
        (subject_id, topic_name),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()

    return jsonify({'id': new_id, 'topic_name': topic_name}), 201


@app.route('/api/topics/<int:topic_id>', methods=['DELETE'])
def delete_topic(topic_id):
    conn = get_connection()
    conn.execute('DELETE FROM syllabus_topics WHERE id = ?', (topic_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------
# Faculty: roster + attendance
# ---------------------------------------------------------------

@app.route('/api/roster')
def get_roster():
    """CSE 5th Sem, Div A roster — the only class in this mini-project."""
    conn = get_connection()
    rows = conn.execute(
        '''SELECT s.id as student_id, s.roll_no, u.name
           FROM students s JOIN users u ON u.id = s.user_id
           ORDER BY s.roll_no'''
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/attendance', methods=['POST'])
def save_attendance():
    """
    Body: {
      subject_id, topic_id, date,
      records: [{ student_id, status }, ...]
    }
    """
    if session.get('role') != 'faculty':
        return jsonify({'error': 'Only faculty can mark attendance'}), 403

    data = request.get_json(force=True)
    subject_id = data.get('subject_id')
    topic_id = data.get('topic_id')
    date = data.get('date') or datetime.now().strftime('%Y-%m-%d')
    records = data.get('records', [])
    marked_by = session.get('user_id')

    conn = get_connection()
    absentee_count = 0

    subject_row = conn.execute('SELECT name FROM subjects WHERE id = ?', (subject_id,)).fetchone()
    subject_name = subject_row['name'] if subject_row else 'Unknown subject'

    topic_name = None
    if topic_id:
        topic_row = conn.execute('SELECT topic_name FROM syllabus_topics WHERE id = ?', (topic_id,)).fetchone()
        topic_name = topic_row['topic_name'] if topic_row else None

    for r in records:
        conn.execute(
            '''INSERT INTO attendance (student_id, subject_id, topic_id, date, status, marked_by)
               VALUES (?, ?, ?, ?, ?, ?)''',
            (r['student_id'], subject_id, topic_id, date, r['status'], marked_by),
        )
        if r['status'] == 'absent':
            absentee_count += 1

            info = conn.execute(
                '''SELECT u.name as student_name, pu.email as parent_email
                   FROM students s
                   JOIN users u ON u.id = s.user_id
                   LEFT JOIN users pu ON pu.id = s.parent_user_id
                   WHERE s.id = ?''',
                (r['student_id'],),
            ).fetchone()

            if info and info['parent_email']:
                send_absence_email(info['parent_email'], info['student_name'], subject_name, topic_name)

    conn.commit()
    conn.close()

    return jsonify({'ok': True, 'absentees_notified': absentee_count})


@app.route('/api/faculty/sessions')
def faculty_sessions():
    """Past sessions this faculty has marked, grouped by date+subject+topic."""
    if session.get('role') != 'faculty':
        return jsonify({'error': 'Faculty only'}), 403

    conn = get_connection()
    rows = conn.execute(
        '''SELECT a.date, sub.name as subject, t.topic_name as topic,
                  SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) as present,
                  SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) as absent
           FROM attendance a
           JOIN subjects sub ON sub.id = a.subject_id
           LEFT JOIN syllabus_topics t ON t.id = a.topic_id
           WHERE a.marked_by = ?
           GROUP BY a.date, a.subject_id, a.topic_id
           ORDER BY a.date DESC
           LIMIT 30''',
        (session['user_id'],),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------
# Student: attendance % + history
# ---------------------------------------------------------------

@app.route('/api/student/attendance')
def student_attendance():
    if session.get('role') != 'student':
        return jsonify({'error': 'Students only'}), 403

    conn = get_connection()
    student = conn.execute(
        'SELECT id FROM students WHERE user_id = ?', (session['user_id'],)
    ).fetchone()

    if not student:
        conn.close()
        return jsonify({'error': 'Student record not found'}), 404

    student_id = student['id']

    subject_rows = conn.execute(
        '''SELECT sub.name as subject,
                  SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) as attended,
                  COUNT(*) as total
           FROM attendance a JOIN subjects sub ON sub.id = a.subject_id
           WHERE a.student_id = ?
           GROUP BY a.subject_id''',
        (student_id,),
    ).fetchall()

    history_rows = conn.execute(
        '''SELECT a.date, sub.name as subject, t.topic_name as topic, a.status
           FROM attendance a
           JOIN subjects sub ON sub.id = a.subject_id
           LEFT JOIN syllabus_topics t ON t.id = a.topic_id
           WHERE a.student_id = ?
           ORDER BY a.date DESC LIMIT 20''',
        (student_id,),
    ).fetchall()

    conn.close()

    return jsonify({
        'subjects': [dict(r) for r in subject_rows],
        'history': [dict(r) for r in history_rows],
    })


@app.route('/api/student/trend')
def student_trend():
    """Weekly attendance % for the last 6 weeks, for the trend chart."""
    if session.get('role') != 'student':
        return jsonify({'error': 'Students only'}), 403

    conn = get_connection()
    student = conn.execute(
        'SELECT id FROM students WHERE user_id = ?', (session['user_id'],)
    ).fetchone()
    if not student:
        conn.close()
        return jsonify([])

    rows = conn.execute(
        '''SELECT strftime('%Y-%W', date) as week,
                  SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) as attended,
                  COUNT(*) as total
           FROM attendance
           WHERE student_id = ?
           GROUP BY week
           ORDER BY week DESC
           LIMIT 6''',
        (student['id'],),
    ).fetchall()
    conn.close()

    weeks = [
        {'week': r['week'], 'pct': round((r['attended'] / r['total']) * 100) if r['total'] else 0}
        for r in rows
    ]
    weeks.reverse()  # oldest first, for a left-to-right chart
    return jsonify(weeks)


# ---------------------------------------------------------------
# Parent: notifications
# ---------------------------------------------------------------

@app.route('/api/parent/notifications')
def parent_notifications():
    if session.get('role') != 'parent':
        return jsonify({'error': 'Parents only'}), 403

    conn = get_connection()
    child = conn.execute(
        '''SELECT s.id as student_id, u.name
           FROM students s JOIN users u ON u.id = s.user_id
           WHERE s.parent_user_id = ?''',
        (session['user_id'],),
    ).fetchone()

    if not child:
        conn.close()
        return jsonify({'error': 'No linked child found'}), 404

    notifications = conn.execute(
        '''SELECT a.date, sub.name as subject, t.topic_name as topic, a.status
           FROM attendance a
           JOIN subjects sub ON sub.id = a.subject_id
           LEFT JOIN syllabus_topics t ON t.id = a.topic_id
           WHERE a.student_id = ? AND a.status = 'absent'
           ORDER BY a.date DESC LIMIT 20''',
        (child['student_id'],),
    ).fetchall()

    complaints = conn.execute(
        '''SELECT c.created_at as date, c.message, u.name as faculty_name
           FROM complaints c
           LEFT JOIN users u ON u.id = c.faculty_id
           WHERE c.student_id = ?
           ORDER BY c.created_at DESC LIMIT 20''',
        (child['student_id'],),
    ).fetchall()

    conn.close()

    combined = (
        [{'type': 'absent', 'date': r['date'], 'subject': r['subject'], 'topic': r['topic']} for r in notifications]
        + [{'type': 'complaint', 'date': r['date'], 'message': r['message'], 'faculty_name': r['faculty_name']} for r in complaints]
    )
    combined.sort(key=lambda x: x['date'], reverse=True)

    return jsonify({
        'child_name': child['name'],
        'notifications': combined,
    })


@app.route('/api/parent/attendance')
def parent_attendance():
    """Child's overall % + subject-wise breakdown, for the Attendance Summary tab."""
    if session.get('role') != 'parent':
        return jsonify({'error': 'Parents only'}), 403

    conn = get_connection()
    child = conn.execute(
        '''SELECT s.id as student_id, u.name
           FROM students s JOIN users u ON u.id = s.user_id
           WHERE s.parent_user_id = ?''',
        (session['user_id'],),
    ).fetchone()

    if not child:
        conn.close()
        return jsonify({'error': 'No linked child found'}), 404

    subject_rows = conn.execute(
        '''SELECT sub.name as subject,
                  SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) as attended,
                  COUNT(*) as total
           FROM attendance a JOIN subjects sub ON sub.id = a.subject_id
           WHERE a.student_id = ?
           GROUP BY a.subject_id''',
        (child['student_id'],),
    ).fetchall()

    conn.close()

    return jsonify({
        'child_name': child['name'],
        'subjects': [dict(r) for r in subject_rows],
    })


# ---------------------------------------------------------------
# Marks
# ---------------------------------------------------------------

@app.route('/api/marks', methods=['POST'])
def save_marks():
    """
    Body: { subject_id, exam_type, max_marks, records: [{ student_id, score }, ...] }

    Integrity rule: once a mark exists for a given student+subject+exam,
    it is LOCKED — faculty cannot overwrite it (prevents a teacher quietly
    bumping one student's marks up or down after the fact). Only brand-new
    entries (students with no existing row) are saved; anything else is
    skipped and reported back as 'locked'.
    """
    if session.get('role') != 'faculty':
        return jsonify({'error': 'Only faculty can enter marks'}), 403

    data = request.get_json(force=True)
    subject_id = data.get('subject_id')
    exam_type = data.get('exam_type')
    max_marks = data.get('max_marks')
    records = data.get('records', [])
    entered_by = session.get('user_id')

    conn = get_connection()
    saved = 0
    locked = 0

    for r in records:
        if r.get('score') in (None, ''):
            continue

        existing = conn.execute(
            'SELECT id FROM marks WHERE student_id = ? AND subject_id = ? AND exam_type = ?',
            (r['student_id'], subject_id, exam_type),
        ).fetchone()

        if existing:
            locked += 1
            continue

        conn.execute(
            '''INSERT INTO marks (student_id, subject_id, exam_type, score, max_marks, entered_by)
               VALUES (?, ?, ?, ?, ?, ?)''',
            (r['student_id'], subject_id, exam_type, r['score'], max_marks, entered_by),
        )
        saved += 1

    conn.commit()
    conn.close()

    return jsonify({'ok': True, 'saved': saved, 'locked': locked})


@app.route('/api/marks/existing')
def existing_marks():
    """For the Marks tab: which students already have a locked mark for
    this subject+exam, so the faculty UI can show them as read-only."""
    if session.get('role') != 'faculty':
        return jsonify({'error': 'Faculty only'}), 403

    subject_id = request.args.get('subject_id')
    exam_type = request.args.get('exam_type')

    conn = get_connection()
    rows = conn.execute(
        'SELECT student_id, score, max_marks FROM marks WHERE subject_id = ? AND exam_type = ?',
        (subject_id, exam_type),
    ).fetchall()
    conn.close()

    return jsonify([dict(r) for r in rows])


@app.route('/api/student/marks')
def student_marks():
    if session.get('role') != 'student':
        return jsonify({'error': 'Students only'}), 403

    conn = get_connection()
    student = conn.execute(
        'SELECT id FROM students WHERE user_id = ?', (session['user_id'],)
    ).fetchone()
    if not student:
        conn.close()
        return jsonify([])

    rows = conn.execute(
        '''SELECT sub.name as subject, m.exam_type as exam, m.score, m.max_marks as max
           FROM marks m JOIN subjects sub ON sub.id = m.subject_id
           WHERE m.student_id = ?
           ORDER BY sub.name, m.exam_type''',
        (student['id'],),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/parent/marks')
def parent_marks():
    if session.get('role') != 'parent':
        return jsonify({'error': 'Parents only'}), 403

    conn = get_connection()
    child = conn.execute(
        'SELECT id, (SELECT name FROM users WHERE id = students.user_id) as name FROM students WHERE parent_user_id = ?',
        (session['user_id'],),
    ).fetchone()
    if not child:
        conn.close()
        return jsonify({'child_name': None, 'marks': []})

    rows = conn.execute(
        '''SELECT sub.name as subject, m.exam_type as exam, m.score, m.max_marks as max
           FROM marks m JOIN subjects sub ON sub.id = m.subject_id
           WHERE m.student_id = ?
           ORDER BY sub.name, m.exam_type''',
        (child['id'],),
    ).fetchall()
    conn.close()
    return jsonify({'child_name': child['name'], 'marks': [dict(r) for r in rows]})


# ---------------------------------------------------------------
# Complaints (faculty -> parent note)
# ---------------------------------------------------------------

@app.route('/api/complaint', methods=['POST'])
def send_complaint():
    if session.get('role') != 'faculty':
        return jsonify({'error': 'Only faculty can send a complaint'}), 403

    data = request.get_json(force=True)
    student_id = data.get('student_id')
    message = (data.get('message') or '').strip()

    if not student_id or not message:
        return jsonify({'error': 'student_id and message are required'}), 400

    conn = get_connection()
    conn.execute(
        'INSERT INTO complaints (student_id, faculty_id, message) VALUES (?, ?, ?)',
        (student_id, session.get('user_id'), message),
    )
    conn.commit()

    info = conn.execute(
        '''SELECT u.name as student_name, pu.email as parent_email, fu.name as faculty_name
           FROM students s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN users pu ON pu.id = s.parent_user_id
           LEFT JOIN users fu ON fu.id = ?
           WHERE s.id = ?''',
        (session.get('user_id'), student_id),
    ).fetchone()
    conn.close()

    if info and info['parent_email']:
        send_complaint_email(info['parent_email'], info['student_name'], info['faculty_name'], message)

    return jsonify({'ok': True})


DEFAULT_PASSWORD = 'password123'   # everyone starts with this; users change it themselves
EMAIL_PATTERN = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
ROLL_PATTERN = re.compile(r'^\d{10}$')


@app.route('/api/students', methods=['POST'])
def enroll_student():
    """Faculty enrolls a new student. Creates the student's login AND the
    parent's login (reusing the parent account if that email is already
    registered, e.g. a sibling). Both start with the default password.
    Students can't be edited or deleted afterwards."""
    if session.get('role') != 'faculty':
        return jsonify({'error': 'Only faculty can enroll students'}), 403

    data = request.get_json(force=True)
    name = ' '.join((data.get('name') or '').split())
    roll_no = (data.get('roll_no') or '').strip()
    parent_email = (data.get('parent_email') or '').strip().lower()

    if not name or not roll_no or not parent_email:
        return jsonify({'error': 'Name, Roll No and parent email are all required'}), 400
    if not ROLL_PATTERN.match(roll_no):
        return jsonify({'error': 'Roll No must be exactly 10 digits (e.g. 2401202009)'}), 400
    if not EMAIL_PATTERN.match(parent_email):
        return jsonify({'error': 'Enter a valid parent email address'}), 400

    student_email = f"{roll_no}@krishnaschool.edu.in"

    conn = get_connection()

    if conn.execute('SELECT 1 FROM students WHERE roll_no = ?', (roll_no,)).fetchone():
        conn.close()
        return jsonify({'error': f'Roll No {roll_no} is already enrolled'}), 400

    parent_created = False
    try:
        cur = conn.execute(
            'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
            (name, student_email, generate_password_hash(DEFAULT_PASSWORD), 'student'),
        )
        student_user_id = cur.lastrowid

        parent = conn.execute(
            "SELECT id FROM users WHERE email = ? AND role = 'parent'", (parent_email,)
        ).fetchone()
        if parent:
            parent_user_id = parent['id']
        else:
            if conn.execute('SELECT 1 FROM users WHERE email = ?', (parent_email,)).fetchone():
                conn.rollback()
                conn.close()
                return jsonify({'error': 'That email already belongs to a non-parent account'}), 400
            cur = conn.execute(
                'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
                (f"Parent of {name}", parent_email, generate_password_hash(DEFAULT_PASSWORD), 'parent'),
            )
            parent_user_id = cur.lastrowid
            parent_created = True

        conn.execute(
            '''INSERT INTO students (user_id, roll_no, class_name, division, parent_user_id)
               VALUES (?, ?, ?, ?, ?)''',
            (student_user_id, roll_no, 'CSE 5th Sem', 'A', parent_user_id),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(e)}), 400

    conn.close()

    return jsonify({
        'ok': True,
        'roll_no': roll_no,
        'student_email': student_email,
        'parent_email': parent_email,
        'parent_created': parent_created,
        'default_password': DEFAULT_PASSWORD,
    }), 201


# ---------------------------------------------------------------
# Account: change own password (all roles)
# ---------------------------------------------------------------

@app.route('/api/change-password', methods=['POST'])
def change_password():
    if 'user_id' not in session:
        return jsonify({'error': 'Not logged in'}), 401

    data = request.get_json(force=True)
    current = data.get('current_password') or ''
    new = data.get('new_password') or ''

    if len(new) < 6:
        return jsonify({'error': 'New password must be at least 6 characters'}), 400
    if new == current:
        return jsonify({'error': 'New password must be different from the current one'}), 400

    conn = get_connection()
    user = conn.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()

    if not user or not check_password_hash(user['password'], current):
        conn.close()
        return jsonify({'error': 'Current password is incorrect'}), 400

    conn.execute(
        'UPDATE users SET password = ? WHERE id = ?',
        (generate_password_hash(new), user['id']),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


if __name__ == '__main__':
    app.run(debug=True, port=5000)