const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  classroom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Classroom',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AttendanceSession',
    required: true
  },
  status: {
    type: String,
    enum: ['present', 'absent', 'late', 'excused'],
    required: true
  },
  markedAt: {
    type: Date,
    default: Date.now
  },
  location: {
    latitude: {
      type: Number,
      required: function() {
        return this.status === 'present' || this.status === 'late';
      }
    },
    longitude: {
      type: Number,
      required: function() {
        return this.status === 'present' || this.status === 'late';
      }
    },
    accuracy: {
      type: Number,
      default: null
    },
    address: {
      type: String,
      default: null
    },
    isWithinGeofence: {
      type: Boolean,
      default: false
    }
  },
  verification: {
    method: {
      type: String,
      enum: ['otp', 'biometric', 'location', 'manual'],
      required: true
    },
    otpCode: {
      type: String,
      default: null
    },
    biometricVerified: {
      type: Boolean,
      default: false
    },
    faceMatch: {
      type: Number, // confidence score 0-1
      default: null
    },
    deviceInfo: {
      userAgent: String,
      platform: String,
      ipAddress: String
    }
  },
  notes: {
    type: String,
    default: null
  },
  isProxy: {
    type: Boolean,
    default: false
  },
  proxyReason: {
    type: String,
    default: null
  },
  markedBy: {
    type: String,
    enum: ['student', 'teacher', 'admin'],
    default: 'student'
  },
  isEdited: {
    type: Boolean,
    default: false
  },
  editedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  editedAt: {
    type: Date,
    default: null
  },
  editReason: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Indexes for better performance
attendanceSchema.index({ classroom: 1, student: 1 });
attendanceSchema.index({ session: 1 });
attendanceSchema.index({ markedAt: 1 });
attendanceSchema.index({ status: 1 });
attendanceSchema.index({ 'location.latitude': 1, 'location.longitude': 1 });

// Compound indexes
attendanceSchema.index({ classroom: 1, markedAt: -1 });
attendanceSchema.index({ student: 1, markedAt: -1 });
attendanceSchema.index({ teacher: 1, markedAt: -1 });

// Calculate distance between two coordinates
attendanceSchema.methods.calculateDistance = function(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
};

// Check if location is within geofence
attendanceSchema.methods.isWithinGeofence = function(classroomLocation, radius) {
  if (!this.location.latitude || !this.location.longitude) {
    return false;
  }
  
  const distance = this.calculateDistance(
    this.location.latitude,
    this.location.longitude,
    classroomLocation.latitude,
    classroomLocation.longitude
  );
  
  return distance <= radius;
};

// Get attendance summary for a student
attendanceSchema.statics.getStudentSummary = function(studentId, classroomId, startDate, endDate) {
  const matchStage = {
    student: mongoose.Types.ObjectId(studentId)
  };
  
  if (classroomId) {
    matchStage.classroom = mongoose.Types.ObjectId(classroomId);
  }
  
  if (startDate && endDate) {
    matchStage.markedAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$count' },
        present: {
          $sum: {
            $cond: [{ $eq: ['$_id', 'present'] }, '$count', 0]
          }
        },
        absent: {
          $sum: {
            $cond: [{ $eq: ['$_id', 'absent'] }, '$count', 0]
          }
        },
        late: {
          $sum: {
            $cond: [{ $eq: ['$_id', 'late'] }, '$count', 0]
          }
        },
        excused: {
          $sum: {
            $cond: [{ $eq: ['$_id', 'excused'] }, '$count', 0]
          }
        }
      }
    },
    {
      $addFields: {
        attendancePercentage: {
          $multiply: [
            { $divide: ['$present', '$total'] },
            100
          ]
        }
      }
    }
  ]);
};

// Get classroom attendance summary
attendanceSchema.statics.getClassroomSummary = function(classroomId, sessionId) {
  const matchStage = { classroom: mongoose.Types.ObjectId(classroomId) };
  
  if (sessionId) {
    matchStage.session = mongoose.Types.ObjectId(sessionId);
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        students: { $addToSet: '$student' }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$count' },
        present: {
          $sum: {
            $cond: [{ $eq: ['$_id', 'present'] }, '$count', 0]
          }
        },
        absent: {
          $sum: {
            $cond: [{ $eq: ['$_id', 'absent'] }, '$count', 0]
          }
        },
        late: {
          $sum: {
            $cond: [{ $eq: ['$_id', 'late'] }, '$count', 0]
          }
        },
        excused: {
          $sum: {
            $cond: [{ $eq: ['$_id', 'excused'] }, '$count', 0]
          }
        },
        uniqueStudents: {
          $sum: {
            $cond: [{ $eq: ['$_id', 'present'] }, { $size: '$students' }, 0]
          }
        }
      }
    }
  ]);
};

module.exports = mongoose.model('Attendance', attendanceSchema);
