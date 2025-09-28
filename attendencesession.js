const mongoose = require('mongoose');

const attendanceSessionSchema = new mongoose.Schema({
  classroom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Classroom',
    required: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  scheduledDate: {
    type: Date,
    required: true
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  attendanceWindow: {
    start: {
      type: Date,
      required: true
    },
    end: {
      type: Date,
      required: true
    }
  },
  status: {
    type: String,
    enum: ['scheduled', 'active', 'completed', 'cancelled'],
    default: 'scheduled'
  },
  settings: {
    allowLateAttendance: {
      type: Boolean,
      default: false
    },
    requireLocation: {
      type: Boolean,
      default: true
    },
    requireBiometric: {
      type: Boolean,
      default: false
    },
    autoMarkAbsent: {
      type: Boolean,
      default: true
    },
    attendanceWindowMinutes: {
      type: Number,
      default: 5,
      min: 1,
      max: 30
    }
  },
  location: {
    name: {
      type: String,
      required: true
    },
    coordinates: {
      latitude: {
        type: Number,
        required: true
      },
      longitude: {
        type: Number,
        required: true
      }
    },
    radius: {
      type: Number,
      default: 100, // meters
      min: 10,
      max: 1000
    }
  },
  attendance: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Attendance'
  }],
  statistics: {
    totalStudents: {
      type: Number,
      default: 0
    },
    presentCount: {
      type: Number,
      default: 0
    },
    absentCount: {
      type: Number,
      default: 0
    },
    lateCount: {
      type: Number,
      default: 0
    },
    excusedCount: {
      type: Number,
      default: 0
    },
    attendancePercentage: {
      type: Number,
      default: 0
    }
  },
  qrCode: {
    type: String,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  notes: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Indexes for better performance
attendanceSessionSchema.index({ classroom: 1 });
attendanceSessionSchema.index({ teacher: 1 });
attendanceSessionSchema.index({ scheduledDate: 1 });
attendanceSessionSchema.index({ status: 1 });
attendanceSessionSchema.index({ startTime: 1, endTime: 1 });
attendanceSessionSchema.index({ 'attendanceWindow.start': 1, 'attendanceWindow.end': 1 });

// Compound indexes
attendanceSessionSchema.index({ classroom: 1, scheduledDate: -1 });
attendanceSessionSchema.index({ teacher: 1, scheduledDate: -1 });
attendanceSessionSchema.index({ status: 1, scheduledDate: -1 });

// Pre-save middleware to calculate attendance window
attendanceSessionSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('startTime') || this.isModified('attendanceWindowMinutes')) {
    this.attendanceWindow.start = this.startTime;
    this.attendanceWindow.end = new Date(this.startTime.getTime() + (this.settings.attendanceWindowMinutes * 60 * 1000));
  }
  next();
});

// Check if session is currently active
attendanceSessionSchema.methods.isActive = function() {
  const now = new Date();
  return this.status === 'active' && 
         now >= this.startTime && 
         now <= this.endTime;
};

// Check if attendance window is open
attendanceSessionSchema.methods.isAttendanceWindowOpen = function() {
  const now = new Date();
  return this.status === 'active' && 
         now >= this.attendanceWindow.start && 
         now <= this.attendanceWindow.end;
};

// Check if student can mark attendance
attendanceSessionSchema.methods.canMarkAttendance = function(studentId) {
  if (!this.isAttendanceWindowOpen()) {
    return { canMark: false, reason: 'Attendance window is closed' };
  }
  
  if (this.attendance.includes(studentId)) {
    return { canMark: false, reason: 'Attendance already marked' };
  }
  
  return { canMark: true };
};

// Start the attendance session
attendanceSessionSchema.methods.startSession = function() {
  this.status = 'active';
  this.startTime = new Date();
  this.attendanceWindow.start = this.startTime;
  this.attendanceWindow.end = new Date(this.startTime.getTime() + (this.settings.attendanceWindowMinutes * 60 * 1000));
  return this.save();
};

// End the attendance session
attendanceSessionSchema.methods.endSession = function() {
  this.status = 'completed';
  this.endTime = new Date();
  return this.save();
};

// Cancel the attendance session
attendanceSessionSchema.methods.cancelSession = function() {
  this.status = 'cancelled';
  return this.save();
};

// Update statistics
attendanceSessionSchema.methods.updateStatistics = async function() {
  const Attendance = mongoose.model('Attendance');
  
  const stats = await Attendance.aggregate([
    { $match: { session: this._id } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
  
  this.statistics.totalStudents = stats.reduce((sum, stat) => sum + stat.count, 0);
  this.statistics.presentCount = stats.find(s => s._id === 'present')?.count || 0;
  this.statistics.absentCount = stats.find(s => s._id === 'absent')?.count || 0;
  this.statistics.lateCount = stats.find(s => s._id === 'late')?.count || 0;
  this.statistics.excusedCount = stats.find(s => s._id === 'excused')?.count || 0;
  
  if (this.statistics.totalStudents > 0) {
    this.statistics.attendancePercentage = 
      (this.statistics.presentCount / this.statistics.totalStudents) * 100;
  }
  
  return this.save();
};

// Get session summary
attendanceSessionSchema.methods.getSummary = function() {
  return {
    id: this._id,
    title: this.title,
    scheduledDate: this.scheduledDate,
    startTime: this.startTime,
    endTime: this.endTime,
    status: this.status,
    statistics: this.statistics,
    isActive: this.isActive(),
    isAttendanceWindowOpen: this.isAttendanceWindowOpen()
  };
};

// Static method to get active sessions
attendanceSessionSchema.statics.getActiveSessions = function() {
  const now = new Date();
  return this.find({
    status: 'active',
    startTime: { $lte: now },
    endTime: { $gte: now }
  });
};

// Static method to get sessions by date range
attendanceSessionSchema.statics.getSessionsByDateRange = function(startDate, endDate, classroomId) {
  const query = {
    scheduledDate: {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    }
  };
  
  if (classroomId) {
    query.classroom = classroomId;
  }
  
  return this.find(query).sort({ scheduledDate: -1 });
};

module.exports = mongoose.model('AttendanceSession', attendanceSessionSchema);
