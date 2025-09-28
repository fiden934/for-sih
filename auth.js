const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        message: 'Access token required',
        code: 'NO_TOKEN'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({ 
        message: 'Invalid token - user not found',
        code: 'INVALID_TOKEN'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ 
        message: 'Account is deactivated',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }

    if (user.isLocked) {
      return res.status(401).json({ 
        message: 'Account is locked due to multiple failed login attempts',
        code: 'ACCOUNT_LOCKED'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        message: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        message: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    console.error('Auth middleware error:', error);
    res.status(500).json({ 
      message: 'Authentication error',
      code: 'AUTH_ERROR'
    });
  }
};

// Check if user has required role
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        required: roles,
        current: req.user.role
      });
    }

    next();
  };
};

// Check if user is admin
const requireAdmin = requireRole('admin');

// Check if user is teacher or admin
const requireTeacherOrAdmin = requireRole('teacher', 'admin');

// Check if user is student, teacher, or admin
const requireAnyRole = requireRole('student', 'teacher', 'admin');

// Check if user can access classroom
const requireClassroomAccess = async (req, res, next) => {
  try {
    const { classroomId } = req.params;
    const Classroom = require('../models/Classroom');
    
    const classroom = await Classroom.findById(classroomId);
    if (!classroom) {
      return res.status(404).json({ 
        message: 'Classroom not found',
        code: 'CLASSROOM_NOT_FOUND'
      });
    }

    // Admin can access any classroom
    if (req.user.role === 'admin') {
      req.classroom = classroom;
      return next();
    }

    // Teacher can access their own classrooms
    if (req.user.role === 'teacher' && classroom.teacher.equals(req.user._id)) {
      req.classroom = classroom;
      return next();
    }

    // Student can access classrooms they're enrolled in
    if (req.user.role === 'student' && classroom.students.includes(req.user._id)) {
      req.classroom = classroom;
      return next();
    }

    return res.status(403).json({ 
      message: 'Access denied to this classroom',
      code: 'CLASSROOM_ACCESS_DENIED'
    });
  } catch (error) {
    console.error('Classroom access middleware error:', error);
    res.status(500).json({ 
      message: 'Error checking classroom access',
      code: 'CLASSROOM_ACCESS_ERROR'
    });
  }
};

// Rate limiting for sensitive operations
const rateLimitByUser = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  const attempts = new Map();
  
  return (req, res, next) => {
    const userId = req.user?._id?.toString();
    if (!userId) return next();
    
    const now = Date.now();
    const userAttempts = attempts.get(userId) || [];
    
    // Remove old attempts outside the window
    const validAttempts = userAttempts.filter(time => now - time < windowMs);
    
    if (validAttempts.length >= maxAttempts) {
      return res.status(429).json({
        message: 'Too many attempts. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((validAttempts[0] + windowMs - now) / 1000)
      });
    }
    
    validAttempts.push(now);
    attempts.set(userId, validAttempts);
    
    next();
  };
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      if (user && user.isActive && !user.isLocked) {
        req.user = user;
      }
    }
    
    next();
  } catch (error) {
    // Ignore auth errors for optional auth
    next();
  }
};

module.exports = {
  authenticateToken,
  requireRole,
  requireAdmin,
  requireTeacherOrAdmin,
  requireAnyRole,
  requireClassroomAccess,
  rateLimitByUser,
  optionalAuth
};
