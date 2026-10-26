"""
Sets up classsync.db (SQLite file) using schema.sql, then fills it with
demo data so you can log in and test immediately without signing up.

Run this once: python database.py
Re-running it is safe — it deletes any existing classsync.db first.
"""

import sqlite3
import os
from werkzeug.security import generate_password_hash

DB_PATH = os.path.join(os.path.dirname(__file__), 'classsync.db')


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def init_db():
    # Start fresh every time this script runs
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)

    conn = get_connection()
    with open(os.path.join(os.path.dirname(__file__), 'schema.sql')) as f:
        conn.executescript(f.read())

    seed_demo_data(conn)
    conn.commit()
    conn.close()
    print(f"Database created at {DB_PATH}")


def seed_demo_data(conn):
    cur = conn.cursor()

    # ---- Subjects ----
    subjects = [
        'Data Mining & Data Warehousing',
        'Design and Analysis of Algorithms',
        'Python Programming',
        'IT in Business',
        'Computer Networks',
        'Web Application Security',
    ]
    for s in subjects:
        cur.execute('INSERT INTO subjects (name) VALUES (?)', (s,))

    subject_ids = {name: i + 1 for i, name in enumerate(subjects)}

    # ---- Syllabus topics ----
    topics_by_subject = {
        'Data Mining & Data Warehousing': [
            'Module 1 — Data warehousing, architecture, OLAP',
            'Module 2 — Data mining functionalities & association rule mining',
            'Module 3 — Classification & prediction methods',
        ],
        'Design and Analysis of Algorithms': [
            'Module 1 — Algorithm basics, complexity, asymptotic notations',
            'Module 2 — Recurrence relations & sorting algorithms',
            'Module 3 — Divide and conquer algorithms',
            'Module 4 — Dynamic programming',
        ],
        'Python Programming': [
            'Module 1 — Introduction to Python, branching, control structures',
            'Module 2 — Functions, scoping and abstraction',
            'Module 3 — Structured types, mutability, higher-order functions',
            'Module 4 — Testing, debugging, exception & file handling',
        ],
        'IT in Business': [
            'Module 1 — IT and Business overview, information systems',
            'Module 2 — Number systems & data representation',
            'Module 3 — Email & Internet',
        ],
        'Computer Networks': [
            'Module 1 — Introduction to networks, hardware, throughput',
            'Module 2 — Application layer: HTTP, Email, DNS, sockets',
        ],
        'Web Application Security': [
            'Module 1 — Introduction: web app security vs network/cloud security',
            'Module 2 — Security fundamentals & OWASP Top 10 vulnerabilities',
            'Module 3 — XSS & Cross-Site Request Forgery: detection & prevention',
        ],
    }
    for subject_name, topics in topics_by_subject.items():
        sid = subject_ids[subject_name]
        for t in topics:
            cur.execute(
                'INSERT INTO syllabus_topics (subject_id, topic_name) VALUES (?, ?)',
                (sid, t),
            )

    # ---- Demo users: 1 faculty, 8 students, 8 parents ----
    def add_user(name, email, password, role):
        cur.execute(
            'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
            (name, email, generate_password_hash(password), role),
        )
        return cur.lastrowid

    faculty_id = add_user('Kartik D Gori', 'faculty@krishnaschool.edu.in', 'password123', 'faculty')

    students = [
        ('Rinkle Amin', '2401202001'),
        ('Aarav Patel', '2401202002'),
        ('Diya Shah', '2401202003'),
        ('Kabir Mehta', '2401202004'),
        ('Ishita Rao', '2401202005'),
        ('Yash Trivedi', '2401202006'),
        ('Sneha Joshi', '2401202007'),
        ('Om Desai', '2401202008'),
    ]

    for name, roll in students:
        student_email = f"{roll}@krishnaschool.edu.in"

        if roll == '2401202001':
            parent_email = 'rinklea34.email@gmail.com'
        else:
            parent_email = f"parent.{roll}@example.com"

        student_user_id = add_user(name, student_email, 'password123', 'student')
        parent_user_id = add_user(f"Parent of {name}", parent_email, 'password123', 'parent')

        cur.execute(
            '''INSERT INTO students (user_id, roll_no, class_name, division, parent_user_id)
               VALUES (?, ?, ?, ?, ?)''',
            (student_user_id, roll, 'CSE 5th Sem', 'A', parent_user_id),
        )

    print("Seeded: 1 faculty, 8 students, 8 parents, 4 subjects, syllabus topics.")
    print("\nDemo login (any of these — password is 'password123' for all):")
    print("  Faculty : faculty@krishnaschool.edu.in")
    print("  Student : 2401202002@krishnaschool.edu.in   (Aarav Patel)")
    print("  Parent  : parent.2401202002@example.com     (Aarav's parent)")


if __name__ == '__main__':
    init_db()