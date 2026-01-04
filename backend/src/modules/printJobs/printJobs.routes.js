const { Router } = require('express');
const { authOrTerminal } = require('../../middlewares/authOrTerminal');
const controller = require('./printJobs.controller');

const router = Router();

router.use(authOrTerminal);

router.get('/next', controller.getNext);
router.get('/:id', controller.getById);
router.post('/:id/printed', controller.markPrinted);
router.post('/:id/error', controller.markError);

// DEV-only mocks (somente development)
router.post('/:id/mock-printed', controller.mockPrinted);
router.post('/:id/mock-error', controller.mockError);

module.exports = router;
