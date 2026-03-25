#!/usr/bin/env python3
"""
Simple test script to verify the attendance system setup.
This script checks if all required files are present and provides instructions.
"""

import os
import sys
import json

def check_files():
    """Check if all required files exist"""
    required_files = [
        'index.html',
        'script.js',
        'style.css',
        'manifest.json',
        'sw.js',
        'main.js',
        'package.json'
    ]

    model_files = [
        'models/face_landmark_68_model-shard1',
        'models/face_landmark_68_model-weights_manifest.json',
        'models/face_recognition_model-shard1',
        'models/face_recognition_model-shard2',
        'models/face_recognition_model-weights_manifest.json',
        'models/ssd_mobilenetv1_model-shard1',
        'models/ssd_mobilenetv1_model-shard2',
        'models/ssd_mobilenetv1_model-weights_manifest.json'
    ]

    print("🔍 Checking required files...")

    all_present = True
    for file in required_files:
        if os.path.exists(file):
            print(f"✅ {file}")
        else:
            print(f"❌ {file} - MISSING")
            all_present = False

    print("\n🔍 Checking ML model files...")
    for file in model_files:
        if os.path.exists(file):
            print(f"✅ {file}")
        else:
            print(f"❌ {file} - MISSING")
            all_present = False

    return all_present

def check_package_json():
    """Check package.json for required dependencies"""
    if not os.path.exists('package.json'):
        return False

    try:
        with open('package.json', 'r') as f:
            package = json.load(f)

        deps = package.get('dependencies', {})
        required_deps = ['electron']

        print("\n🔍 Checking package.json dependencies...")
        for dep in required_deps:
            if dep in deps:
                print(f"✅ {dep}: {deps[dep]}")
            else:
                print(f"❌ {dep} - MISSING")
                return False

        return True
    except:
        print("❌ Error reading package.json")
        return False

def main():
    print("🚀 Smart Attendance System - Setup Verification")
    print("=" * 50)

    # Check current directory
    print(f"📁 Current directory: {os.getcwd()}")

    # Check files
    files_ok = check_files()

    # Check package.json
    package_ok = check_package_json()

    print("\n" + "=" * 50)

    if files_ok and package_ok:
        print("✅ All checks passed! Your attendance system is ready.")
        print("\n📋 To run the application:")
        print("1. Start a web server: python -m http.server 8000")
        print("2. Open http://localhost:8000 in your browser")
        print("3. Or run with Electron: npm start")
        print("\n🎯 Features:")
        print("- Facial recognition with face-api.js")
        print("- Automatic attendance marking")
        print("- Admin panel for registration")
        print("- Real-time confidence scoring")
        print("- Anti-spam protection (5-second cooldown)")
        print("- Multiple face captures for better accuracy")
    else:
        print("❌ Some files are missing. Please ensure all files are present.")
        sys.exit(1)

if __name__ == "__main__":
    main()