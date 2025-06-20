import { getDistance } from 'geolib';
import type { Location } from '../../types';

// Traveling Salesman Problem solver using Simulated Annealing
export function optimizeRoute(locations: Location[], startPoint: Location): Location[] {
  const temperature = 10000;
  const coolingRate = 0.003;
  let currentTemp = temperature;
  
  // Initialize route with nearest neighbor
  let currentRoute = nearestNeighborRoute(locations, startPoint);
  let currentDistance = calculateTotalDistance(currentRoute);
  
  let bestRoute = [...currentRoute];
  let bestDistance = currentDistance;

  while (currentTemp > 1) {
    // Generate neighbor solution by swapping two random cities
    const newRoute = [...currentRoute];
    const [i, j] = getTwoRandomIndices(newRoute.length);
    [newRoute[i], newRoute[j]] = [newRoute[j], newRoute[i]];
    
    const newDistance = calculateTotalDistance(newRoute);
    
    // Calculate acceptance probability
    const acceptanceProbability = Math.exp((currentDistance - newDistance) / currentTemp);
    
    if (newDistance < currentDistance || Math.random() < acceptanceProbability) {
      currentRoute = newRoute;
      currentDistance = newDistance;
      
      if (newDistance < bestDistance) {
        bestRoute = [...newRoute];
        bestDistance = newDistance;
      }
    }
    
    currentTemp *= (1 - coolingRate);
  }
  
  return bestRoute;
}

function nearestNeighborRoute(locations: Location[], startPoint: Location): Location[] {
  const route: Location[] = [startPoint];
  const unvisited = [...locations];
  
  while (unvisited.length > 0) {
    const current = route[route.length - 1];
    let nearest = unvisited[0];
    let minDistance = getDistance(current, nearest);
    
    for (let i = 1; i < unvisited.length; i++) {
      const distance = getDistance(current, unvisited[i]);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = unvisited[i];
      }
    }
    
    route.push(nearest);
    unvisited.splice(unvisited.indexOf(nearest), 1);
  }
  
  return route;
}

function calculateTotalDistance(route: Location[]): number {
  let totalDistance = 0;
  
  for (let i = 0; i < route.length - 1; i++) {
    totalDistance += getDistance(route[i], route[i + 1]);
  }
  
  // Add distance back to start
  totalDistance += getDistance(route[route.length - 1], route[0]);
  
  return totalDistance;
}

function getTwoRandomIndices(length: number): [number, number] {
  const i = Math.floor(Math.random() * length);
  let j = Math.floor(Math.random() * length);
  while (j === i) {
    j = Math.floor(Math.random() * length);
  }
  return [i, j];
}
