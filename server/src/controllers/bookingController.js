// STEP 1: 
import Joi from 'joi'; //used for checking/validating data
import { Booking } from '../models/Booking.js'; //  to save/search for bookinsg
import { User } from '../models/User.js'; // to check users exist

const objectIdPattern = /^[0-9a-fA-F]{24}$/;  

// TODO: write a validation schema for create/update per README.md section 2.
// STEP 2:
// must have rules for creating a booking (must have a room number, start date, end date)
// catches if you don't send something that is required
const createSchema = Joi.object({
  roomNumber: Joi.string().trim().min(1).max(50).required(),
  startDate: Joi.date().iso().required(),
  endDate: Joi.date().iso().required(),
  purpose: Joi.string().trim().max(200).allow('').optional(),
  bookedBy: Joi.string()
    .pattern(objectIdPattern)
    .messages({ 'string.pattern.base': 'bookedBy must be a valid user id' })
    .optional()
}); //

// STEP 3: same as step 2 but for updates 
const updateSchema = Joi.object({
  roomNumber: Joi.string().trim().min(1).max(50),
  startDate: Joi.date().iso(),  
  endDate: Joi.date().iso(),
  purpose: Joi.string().trim().max(200).allow(''),
  bookedBy: Joi.string()
    .pattern(objectIdPattern)
    .messages({ 'string.pattern.base': 'bookedBy must be a valid user id' })
}).min(1); 

// STEP 4: checks if the end date comes after the start date  
function isValidRange(startDate, endDate) {
  return new Date(endDate) > new Date(startDate);
}

// TODO: per README.md section 4, you will need a way to detect whether a
// proposed booking conflicts with an existing one on the same room.
// STEP 5: checking if a room is already booked
async function findConflict(roomNumber, startDate, endDate, excludeId) {
  const query = {
    roomNumber,
    startDate: { $lt: endDate },
    endDate: { $gt: startDate }
  };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  return Booking.findOne(query);
}   

// STEP 6: 
// if bookedby exists and has an _id inside of it, it was populated, so build a clean {id, name, email}
// if bookedby exists but has no _id inside of it, it's just a bare objectid, so convert it to a string
// if it doesn't exist at all, leave it null   

function publicBooking(b) {
  let bookedBy = null;
  if (b.bookedBy) {
    bookedBy = b.bookedBy._id
      ? { id: b.bookedBy._id.toString(), name: b.bookedBy.name, email: b.bookedBy.email }
      : b.bookedBy.toString();
  }
  return {
    id: b._id.toString(),
    roomNumber: b.roomNumber,
    startDate: b.startDate,
    endDate: b.endDate,
    purpose: b.purpose || '',
    bookedBy,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt
  };
}


// GET /api/bookings
// TODO: implement per README.md section 3.
// list every booking for all rooms (and  can also list every booking for a specific room)
export async function getAllBookings(req, res, next) {
  try {
    const { roomNumber } = req.query;
    const query = {};
    if (roomNumber) query.roomNumber = roomNumber;

    const bookings = await Booking.find(query)
      .sort({ startDate: 1 })
      .populate('bookedBy', 'name email')
      .lean();

    res.json({ bookings: bookings.map(publicBooking) });
  }  
    catch (err) { next(err); }  
  
}

// GET /api/bookings/:id
// TODO: implement per README.md sections 3 and 5.
export async function getBooking(req, res, next) {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('bookedBy', 'name email')
      .lean();
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    res.json({ booking: publicBooking(booking) });  
  } catch (err) {
    if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid booking id' });
    next(err);
  }
}

// POST /api/bookings
// TODO: implement per README.md sections 3 and 4.
// STEP 7: runs in order: validate shape --> check date order --> if a user is named confirm that we he was real --> check for a conflicting booking --> only then actulaly save it --> send back the clean version
export async function createBooking(req, res, next) {
  try {
const { value, error } = createSchema.validate(req.body, { abortEarly: false });
    if (error) return res.status(400).json({ message: error.message });

    const { roomNumber, startDate, endDate, purpose, bookedBy } = value;

    if (!isValidRange(startDate, endDate)) {
      return res.status(400).json({ message: 'endDate must be after startDate' });
    }

    if (bookedBy) {
      const userExists = await User.exists({ _id: bookedBy });
      if (!userExists) {
        return res.status(404).json({ message: 'bookedBy does not reference an existing user' });
      }
    }

    const conflict = await findConflict(roomNumber, startDate, endDate);
    if (conflict) {
      return res.status(409).json({
        message: 'That room is already booked for part of this time range',
        conflict: publicBooking(conflict)
      });
    }

    const booking = await Booking.create({ roomNumber, startDate, endDate, purpose, bookedBy });
    await booking.populate('bookedBy', 'name email');
    res.status(201).json({ booking: publicBooking(booking) });
  }
    catch (err) { next(err); }
}

// PATCH /api/bookings/:id
// TODO: implement per README.md sections 3, 4, and 5.

export async function updateBooking(req, res, next) {
  // does the booking actually exist
  // is wat tey are trying to cchange valid?
  try {
        const existing = await Booking.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Booking not found' });

    const { value, error } = updateSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });
    if (error) return res.status(400).json({ message: error.message });
    
    // is it before te start time?

    const roomNumber = value.roomNumber ?? existing.roomNumber;
    const startDate = value.startDate ?? existing.startDate;
    const endDate = value.endDate ?? existing.endDate;

    if (!isValidRange(startDate, endDate)) {
      return res.status(400).json({ message: 'endDate must be after startDate' }); // recheck the order and start an end
    }

        if (value.bookedBy) {
      const userExists = await User.exists({ _id: value.bookedBy });
      if (!userExists) {
        return res.status(404).json({ message: 'bookedBy does not reference an existing user' });
      }
    }

    const conflict = await findConflict(roomNumber, startDate, endDate, existing._id);
    if (conflict) {
      return res.status(409).json({
        message: 'That room is already booked for part of this time range',
        conflict: publicBooking(conflict)
      });
    }

    Object.assign(existing, value);
    await existing.save();
    await existing.populate('bookedBy', 'name email');
    res.json({ booking: publicBooking(existing) });

  }  catch (err) {
    if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid booking id' });
    next(err);
  }

  
}

// DELETE /api/bookings/:id
// TODO: implement per README.md sections 3 and 5.
export async function deleteBooking(req, res, next) {
  try {
    const doc = await Booking.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Booking not found' });
    res.json({ ok: true }); 
  }  catch (err) {
    if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid booking id' });
    next(err);
  }
}
