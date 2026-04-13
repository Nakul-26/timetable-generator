import React, { createContext } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';

const DataContext = createContext({});

export const DataProvider = ({ children }) => {
    const queryClient = useQueryClient();

    const { data: classes = [], isError: isClassesError, isLoading: isClassesLoading } = useQuery({
        queryKey: ['classes'],
        queryFn: () => api.get('/classes').then(res => res.data?.classes || res.data || [])
    });

    const { data: subjects = [], isError: isSubjectsError, isLoading: isSubjectsLoading } = useQuery({
        queryKey: ['subjects'],
        queryFn: () => api.get('/subjects').then(res => res.data?.subjects || res.data || [])
    });

    const { data: faculties = [], isError: isFacultiesError, isLoading: isFacultiesLoading } = useQuery({
        queryKey: ['faculties'],
        queryFn: () => api.get('/faculties').then(res => res.data?.faculties || res.data || [])
    });

    const { data: combos = [], isError: isCombosError, isLoading: isCombosLoading } = useQuery({
        queryKey: ['teacher-subject-combos'],
        queryFn: () => api.get('/teacher-subject-combos').then(res => res.data?.combos || res.data || [])
    });

    const { data: assignments = [], isError: isAssignmentsError, isLoading: isAssignmentsLoading } = useQuery({
        queryKey: ['class-subjects'],
        queryFn: () => api.get('/class-subjects').then(res => res.data?.assignments || res.data || res.data?.classSubjects || res.data || [])
    });

    const loading = isClassesLoading || isSubjectsLoading || isFacultiesLoading || isCombosLoading || isAssignmentsLoading;
    const error = isClassesError || isSubjectsError || isFacultiesError || isCombosError || isAssignmentsError ? "Failed to fetch data." : "";

    const refetchData = (queryKey) => {
        if (queryKey) {
            queryClient.invalidateQueries(queryKey);
        } else {
            queryClient.invalidateQueries();
        }
    };

    return (
        <DataContext.Provider value={{
            classes,
            subjects,
            faculties,
            combos,
            assignments,
            loading,
            error,
            refetchData
        }}>
            {children}
        </DataContext.Provider>
    );
};

export default DataContext;

