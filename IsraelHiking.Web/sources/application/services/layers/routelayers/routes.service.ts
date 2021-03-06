﻿import { Injectable } from "@angular/core";
import { Subject } from "rxjs/Subject";
import * as L from "leaflet";
import * as _ from "lodash";

import { IRouteLayer, IRoute, IRouteSegment, IMarkerWithData } from "./iroute.layer";
import { MapService } from "../../map.service";
import { RouteLayerFactory } from "./route-layer.factory";
import { RouteLayer } from "./route.layer";
import { ResourcesService } from "../../resources.service";
import { IconsService } from "../../icons.service";
import { IRoutesService } from "./iroutes.service";
import * as Common from "../../../common/IsraelHiking";


@Injectable()
export class RoutesService implements IRoutesService {
    private static MERGE_THRESHOLD = 50; // meter.
    
    public routes: IRouteLayer[];
    public routeChanged: Subject<any>;
    public selectedRoute: IRouteLayer;

    constructor(private resourcesService: ResourcesService,
        private mapService: MapService,
        private routeLayerFactory: RouteLayerFactory) {
        this.routes = [];
        this.selectedRoute = null;
        this.routeChanged = new Subject<any>();
    }

    public addRoute = (route: IRoute) => {
        let routeLayer = this.routeLayerFactory.createRouteLayer(route);
        this.routes.push(routeLayer);
        this.mapService.map.addLayer(routeLayer);
        routeLayer.setEditRouteState();
        this.selectRoute(routeLayer);
    }

    public removeRoute = (routeName: string) => {
        let routeLayer = this.getRouteByName(routeName);
        if (routeLayer == null) {
            return;
        }
        if (this.selectedRoute === routeLayer) {
            this.selectRoute(null);
        }
        this.mapService.map.removeLayer(routeLayer as RouteLayer);
        this.routes.splice(this.routes.indexOf(routeLayer), 1);
    }

    public isNameAvailable = (name: string) => {
        var route = this.getRouteByName(name);
        return route == null && name != null && name !== "";
    }
    
    public changeRouteState = (routeLayer: IRouteLayer) => {
        if (routeLayer === this.selectedRoute && routeLayer.route.properties.isVisible) {
            this.selectRoute(null);
            this.mapService.map.removeLayer(routeLayer as RouteLayer);
            return;
        }
        if (routeLayer.route.properties.isVisible === false) {
            this.mapService.map.addLayer(routeLayer as RouteLayer);
        }
        this.selectRoute(routeLayer);
    }

    private selectRoute = (routeLayer: IRouteLayer) => {
        if (this.selectedRoute) {
            this.selectedRoute.setReadOnlyState();
        }
        this.selectedRoute = routeLayer;
        this.routeChanged.next();
    }

    public createRouteName = (routeName: string = this.resourcesService.route) => {
        var index = 1;
        routeName = routeName.replace(/(.*) \d+/, "$1");
        var availableRouteName = `${routeName} ${index}`;
        while (_.some(this.routes, (routeLayer) => routeLayer.route.properties.name === availableRouteName)) {
            index++;
            availableRouteName = `${routeName} ${index}`;
        }
        return availableRouteName;
    }

    public getRouteByName = (routeName: string): IRouteLayer => {
        return _.find(this.routes, (routeLayerToFind) => routeLayerToFind.route.properties.name === routeName);
    }

    public getData = (): Common.RouteData[] => {
        let routesData = [];
        for (let route of this.routes) {
            if (route.route.properties.isVisible) {
                routesData.push(route.getData());
            }
        }
        return routesData;
    }
    
    public setData = (routes: Common.RouteData[]) => {
        if (!routes || routes.length === 0) {
            return;
        }
        this.mapService.routesJsonToRoutesObject(routes);
        for (let route of routes) {
            for (let marker of route.markers) {
                if (!_.find(IconsService.getAvailableIconTypes(), m => m === marker.type)) {
                    marker.type = IconsService.getAvailableIconTypes()[0];
                }
            }
        }
        this.addLayersToMap(routes);
    }

    private addLayersToMap = (routes: Common.RouteData[]) => {
        if (routes.length === 1 && routes[0].segments.length === 0 && this.routes.length > 0) {
            // this is the case when the layer has markers only
            if (this.selectedRoute == null) {
                this.selectedRoute = this.routes[0];
            }
            let editMode = this.selectedRoute.getEditMode();
            this.selectedRoute.setHiddenState();
            for (let marker of routes[0].markers) {
                this.selectedRoute.route.markers.push(marker as IMarkerWithData);
            }

            this.selectedRoute.setEditMode(editMode);
            return;
        }
        for (let routeData of routes) {
            if (this.isNameAvailable(routeData.name) === false) {
                routeData.name = this.createRouteName(routeData.name);
            }
            let routeLayer = this.routeLayerFactory.createRouteLayerFromData(routeData);
            this.routes.push(routeLayer);
            this.mapService.map.addLayer(routeLayer as RouteLayer);
            this.selectRoute(routeLayer);
        }
    }

    public splitSelectedRouteAt(segmenet: IRouteSegment) {
        let segmentIndex = this.selectedRoute.route.segments.indexOf(segmenet);
        let currentRoute = this.selectedRoute.route;
        this.selectedRoute.setHiddenState();
        let postFixSegments = currentRoute.segments.splice(segmentIndex + 1) as Common.RouteSegmentData[];
        let startPoint = this.selectedRoute.getLastLatLng();
        postFixSegments.splice(0, 0,
            {
                latlngs: [startPoint, startPoint],
                routePoint: startPoint,
                routingType: postFixSegments[0].routingType
            } as Common.RouteSegmentData);
        let routePostFix = {
            segments: postFixSegments,
            name: currentRoute.properties.name + this.resourcesService.split,
        } as Common.RouteData;
        
        this.setData([routePostFix]);
        this.selectedRoute.setEditRouteState();
        this.selectedRoute.raiseDataChanged();
    }

    /**
     * This method is used to find the closest route in order to merge between routes.
     * @param isFirst use to signal the method if to check against the beginning or the end of the selected route.
     */
    public getClosestRoute(isFirst: boolean) {
        let latLngToCheck = isFirst
                ? this.selectedRoute.route.segments[0].latlngs[0]
                : this.selectedRoute.getLastLatLng();
        for (let routeLayer of this.routes) {
            if (routeLayer === this.selectedRoute || routeLayer.route.segments.length <= 0) {
                continue;
            }
            if (routeLayer.getLastLatLng().distanceTo(latLngToCheck) < RoutesService.MERGE_THRESHOLD) {
                return routeLayer;
            }
            if (routeLayer.route.segments[0].latlngs[0].distanceTo(latLngToCheck) < RoutesService.MERGE_THRESHOLD) {
                return routeLayer;
            }
        }
        return null;
    }

    public mergeSelectedRouteToClosest(isFirst: boolean) {
        let closestRoute = this.getClosestRoute(isFirst);
        this.selectedRoute.setHiddenState();
        this.removeRoute(closestRoute.route.properties.name);
        let markersToAdd = closestRoute.route.markers;
        this.selectedRoute.route.markers = this.selectedRoute.route.markers.concat(markersToAdd);
        let latLngToCheck = isFirst
            ? this.selectedRoute.route.segments[0].latlngs[0]
            : this.selectedRoute.getLastLatLng();
        if (isFirst) {
            if (closestRoute.route.segments[0].latlngs[0].distanceTo(latLngToCheck) < RoutesService.MERGE_THRESHOLD) {
                closestRoute.reverse();
            }
            this.selectedRoute.route.segments.splice(0, 1);
            this.selectedRoute.route.segments[0].latlngs.splice(0, 0, closestRoute.getLastLatLng());
            this.selectedRoute.route.segments.splice(0, 0, ...closestRoute.route.segments);
        } else { // merging last point
            if (closestRoute.getLastLatLng().distanceTo(latLngToCheck) < RoutesService.MERGE_THRESHOLD) {
                closestRoute.reverse();
            }
            // remove first segment and add last point:
            closestRoute.route.segments.splice(0, 1);
            closestRoute.route.segments[0].latlngs.splice(0, 0, this.selectedRoute.getLastLatLng());
            this.selectedRoute.route.segments.push(...closestRoute.route.segments);
        }
        this.selectedRoute.setEditRouteState();
        this.selectedRoute.raiseDataChanged();
    }
}