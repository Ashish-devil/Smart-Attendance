# Smart Attendance System with Facial Recognition

A modern, AI-powered attendance tracking system using facial recognition technology. Built with face-api.js and Electron for desktop deployment.

## 🚀 Features

- **Real-time Facial Recognition**: Automatically detects and recognizes faces using advanced ML models
- **Multi-angle Face Capture**: Registers users with 3 face captures for improved accuracy
- **Confidence Scoring**: Shows recognition confidence percentage for each detection
- **Anti-spam Protection**: Prevents duplicate attendance marks within 5 seconds
- **Visual Feedback**: Color-coded bounding boxes (Green=Recognized, Orange=Low confidence, Red=Unknown)
- **Admin Panel**: Secure registration of new students
- **Persistent Storage**: Saves attendance data locally with daily reset
- **Export Functionality**: Export attendance logs to CSV
- **PWA Support**: Works offline with service worker caching
- **Responsive Design**: Modern UI that works on different screen sizes

## 🎯 How Facial Recognition Works

1. **Face Detection**: Uses SSD MobileNet v1 to detect faces in real-time
2. **Face Landmarks**: Identifies 68 facial landmarks for precise feature mapping
3. **Face Embeddings**: Converts faces to 128-dimensional vectors using Face Recognition Net
4. **Face Matching**: Compares detected faces against registered faces using Euclidean distance
5. **Attendance Marking**: Automatically marks attendance when confidence > 60%

## 📋 Setup Instructions

### Prerequisites
- Node.js (for Electron app)
- Python 3.x (for local web server)
- Webcam/camera access

### Running the Application

#### Option 1: Web Browser (Recommended for testing)
```bash
# Navigate to the project directory
cd attendance_system

# Start local web server
python -m http.server 8000

# Open in browser
# http://localhost:8000
```

#### Option 2: Electron Desktop App
```bash
# Install dependencies
npm install

# Run the app
npm start
```

#### Option 3: Build Executable
```bash
# Build for your platform
npm run build
```

## 👥 Usage Guide

### For Students
1. **Automatic Attendance**: Simply look at the camera when the app is running
2. **Real-time Feedback**: Green box appears when recognized, attendance is marked automatically
3. **No Manual Input**: No buttons to press - recognition happens instantly

### For Administrators
1. **Login**: Click "Admin Login" and enter password: `admin123`
2. **Register Students**:
   - Enter student's full name
   - Click "Capture & Register"
   - System captures 3 face images automatically
   - Student is registered and marked present
3. **Monitor Attendance**: View real-time attendance in the logs panel
4. **Export Data**: Click "Export Log to CSV" to download attendance records
5. **Manage Data**: Reset daily logs or clear all registered faces

## 🔧 Technical Details

### Face Recognition Parameters
- **Detection Confidence**: 60% minimum for face detection
- **Registration Confidence**: 80% minimum for face capture
- **Matching Threshold**: 0.6 distance threshold (lower = stricter)
- **Frame Rate**: 150ms intervals for smooth performance
- **Anti-spam Delay**: 5 seconds between attendance marks

### Model Files
- `ssd_mobilenetv1_model`: Face detection
- `face_landmark_68_model`: Facial feature detection
- `face_recognition_model`: Face embedding generation

### Data Storage
- **Faces**: Stored in localStorage as labeled face descriptors
- **Attendance**: Daily attendance logs with timestamps
- **Settings**: Persistent across browser sessions

## 🎨 Visual Indicators

- 🟢 **Green Box**: Recognized student (attendance marked)
- 🟠 **Orange Box**: Low confidence match (< 60%)
- 🔴 **Red Box**: Unknown person
- ✅ **Checkmark Notification**: Successful attendance mark
- 📊 **Confidence Percentage**: Shows match accuracy

## 🔒 Security Features

- Admin password protection
- Local storage (no cloud dependency)
- Face data stored locally only
- No external API calls
- Service worker for offline capability

## 🐛 Troubleshooting

### Common Issues

**"Models not loading"**
- Ensure you're running from a web server (not file://)
- Check that model files are in the `/models` directory

**"Camera not working"**
- Grant camera permissions in browser
- Check camera access in system settings

**"Face not recognized"**
- Ensure good lighting
- Look directly at camera
- Re-register with better conditions

**"Low confidence scores"**
- Improve lighting conditions
- Remove glasses/sunglasses if possible
- Ensure face is clearly visible

## 📈 Performance Tips

- Use good lighting for better recognition
- Keep camera steady
- Register users with multiple angles
- Clean camera lens regularly
- Close other applications using camera

## 🔄 Updates & Improvements

The system continuously improves recognition accuracy through:
- Multiple face capture during registration
- Confidence-based matching
- Anti-spam protection
- Real-time feedback

## 📞 Support

For technical issues or feature requests, check the code comments in `script.js` for detailed implementation notes.