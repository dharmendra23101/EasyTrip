/** The distinct-value endpoints the browse filters populate themselves from. */
const placeModel = require('../models/placeModel');
const logger = require('../utils/logger');

const getAllLocations = async (req, res) => {
  try {
    const locations = await placeModel.getUniqueLocations();
    res.status(200).json(locations);
  } catch (error) {
    logger.error({ err: error }, 'Error getting locations');
    res.status(500).json({ message: 'Error getting locations' });
  }
};

const getDistricts = async (req, res) => {
  try {
    const districts = await placeModel.getUniqueDistricts();
    res.status(200).json(districts);
  } catch (error) {
    logger.error({ err: error }, 'Error getting districts');
    res.status(500).json({ message: 'Error getting districts' });
  }
};

const getStates = async (req, res) => {
  try {
    const states = await placeModel.getUniqueStates();
    res.status(200).json(states);
  } catch (error) {
    logger.error({ err: error }, 'Error getting states');
    res.status(500).json({ message: 'Error getting states' });
  }
};

const getTags = async (req, res) => {
  try {
    const tags = await placeModel.getUniqueTags();
    res.status(200).json(tags);
  } catch (error) {
    logger.error({ err: error }, 'Error getting tags');
    res.status(500).json({ message: 'Error getting tags' });
  }
};

// Review functions

module.exports = {
  getAllLocations,
  getDistricts,
  getStates,
  getTags
};
