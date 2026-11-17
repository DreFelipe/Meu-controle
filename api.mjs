import '@netlify/database';
import api from '../../api.js';

export default (req) => api.handle(req);

export const config = {
  path: '/api/*'
};
